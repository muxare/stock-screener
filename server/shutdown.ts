// shutdown.ts — graceful shutdown (platform hardening phase 1.2, moved here by
// phase 2.1 when `index.ts` became a three-line entry script).
//
// `UniverseStore.close()` releases the SQLite read handle, and until phase 1.2
// nothing ever called it — the handle leaked on every restart, which also meant a
// re-import could be blocked by the dying process's own open connection. What is
// worth stating is the ordering, and it did not change when Fastify arrived: the
// listener stops accepting first, requests already running are given the grace
// window, and only then is the provider closed, so a `/backtest` still streaming
// bars does not have the database pulled out from under it.
//
// Fastify takes over the first half of that. `app.close()` stops the listener,
// runs the preClose and onClose hooks, and resolves when the HTTP server is
// down — so there is no `server.close(cb)` to wrap any more. The other two
// guarantees are still ours:
//
//   - Idle keep-alive sockets are dropped rather than waited for. Fastify has a
//     `forceCloseConnections: 'idle'` option, but it only calls
//     `closeIdleConnections()` for a server built by a user `serverFactory`, so
//     switching it on here would look like a mechanism and be a no-op. The
//     explicit call below is the mechanism, and there is only the one.
//   - Whatever is still running when the window expires is cut off, so the
//     process cannot hang. That path says so in the log, because a shutdown that
//     had to force connections is worth noticing in a container's logs.

import { logger } from './logger.ts';
import type { UniverseStore } from './universe.ts';

// How long a shutdown waits for in-flight requests before it stops being polite.
// A full-universe `/backtest` is budgeted at 30 s (SAD#2.4), which is longer than
// any orchestrator will wait, so this is a drain window and not a promise to
// finish the work: ten seconds covers a screen or a signals scan comfortably and
// keeps `docker stop`, whose own default is ten, from escalating to SIGKILL.
const SHUTDOWN_GRACE_MS = 10_000;

// The slice of a Fastify instance a shutdown uses, declared structurally so a
// test double does not have to fabricate the rest of the framework to stand in
// for one.
export interface ClosableApp {
  close(): Promise<void>;
  server: {
    closeIdleConnections(): void;
    closeAllConnections(): void;
  };
}

// How a shutdown reports itself. Injectable so the behaviour can be tested
// without writing to the process's own log, and so the forced path can be
// asserted on rather than eyeballed.
export type ShutdownLog = (msg: string, err?: unknown) => void;

const defaultLog: ShutdownLog = (msg, err) => {
  if (err !== undefined) logger.error({ err }, msg);
  else logger.info(msg);
};

// Close the listener and then the market-data provider, in that order and once.
// Resolves when the handles are released; never rejects.
export function shutdown(
  app: ClosableApp,
  store: Pick<UniverseStore, 'close'>,
  opts: { timeoutMs?: number; log?: ShutdownLog } = {},
): Promise<void> {
  const { timeoutMs = SHUTDOWN_GRACE_MS, log = defaultLog } = opts;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // A provider that fails to close is logged and not thrown: we are on the way
      // out, and an unhandled rejection here would turn a tidy exit into a crash.
      try { store.close(); }
      catch (err) { log('closing the market-data provider failed', err); }
      resolve();
    };
    const timer = setTimeout(() => {
      log(`${timeoutMs}ms grace period expired; closing connections still open`);
      app.server.closeAllConnections();
      finish();
    }, timeoutMs);
    timer.unref?.();
    void app.close().then(
      () => finish(),
      (err: unknown) => { log('closing the HTTP server failed', err); finish(); },
    );
    // After close() has been asked for, not before: a socket with no request on
    // it is of no use to anyone now, and the Vite dev proxy holds one open all
    // day. Without this the drain would be decided by whenever that socket
    // happened to time out.
    app.server.closeIdleConnections();
  });
}

// Wire SIGTERM and SIGINT to `shutdown`. From stage 4 onward this process runs in
// a container, where SIGTERM is how it is asked to stop and an unhandled one is an
// immediate kill with the database handle still open.
//
// A second signal during the drain exits at once with a non-zero code: someone
// pressing Ctrl-C twice means "stop waiting", and the honest answer to that is an
// unclean exit rather than a clean-looking zero. `exit` and `log` are injectable so
// the behaviour can be tested without ending the test runner's own process.
export function installShutdownHandlers(
  app: ClosableApp,
  store: Pick<UniverseStore, 'close'>,
  opts: {
    signals?: NodeJS.Signals[];
    timeoutMs?: number;
    exit?: (code: number) => void;
    log?: ShutdownLog;
  } = {},
): void {
  const {
    signals = ['SIGTERM', 'SIGINT'] as NodeJS.Signals[],
    exit = (code: number) => process.exit(code),
    log = defaultLog,
  } = opts;
  let closing = false;
  for (const signal of signals) {
    process.on(signal, () => {
      if (closing) {
        log(`second ${signal} — exiting without waiting`);
        exit(1);
        return;
      }
      closing = true;
      log(`${signal} received — shutting down`);
      void shutdown(app, store, { timeoutMs: opts.timeoutMs, log }).then(() => {
        log('shutdown complete');
        exit(0);
      });
    });
  }
}
