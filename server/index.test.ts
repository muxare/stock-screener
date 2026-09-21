// index.test.ts — graceful shutdown (platform hardening phase 1.2).
//
// The leak this phase closes is invisible from the outside: `UniverseStore.close()`
// existed and was never called, so every restart of the dev server abandoned the
// SQLite read handle. What is worth pinning is therefore not "does it close" alone
// but the order and the deadline — the provider must outlive the requests that are
// still reading from it, and a shutdown must not be able to hang forever waiting
// for a keep-alive socket that the Vite dev proxy will hold open all day.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Agent, get } from 'node:http';
import { createUniverseStore } from './universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { createScreenServer, shutdown, installShutdownHandlers } from './index.ts';

// A stand-in for the http.Server surface `shutdown` uses, recording the call
// order so the provider-after-listener guarantee can be asserted directly.
function fakeServer(opts: { closeCallsBack?: boolean } = {}) {
  const { closeCallsBack = true } = opts;
  const calls: string[] = [];
  let pending: (() => void) | null = null;
  return {
    calls,
    // Release a server.close() that was deliberately left hanging.
    drain(): void { const cb = pending; pending = null; cb?.(); },
    close(cb?: () => void): void {
      calls.push('close');
      // A real http.Server never calls back synchronously — it calls back once the
      // last connection ends — and the fake would otherwise report an ordering the
      // production path cannot produce.
      if (!cb) return;
      if (closeCallsBack) queueMicrotask(cb);
      else pending = cb;
    },
    closeIdleConnections(): void { calls.push('closeIdleConnections'); },
    closeAllConnections(): void { calls.push('closeAllConnections'); },
  };
}

function fakeStore(calls: string[], onClose?: () => void) {
  return { close(): void { calls.push('store.close'); onClose?.(); } };
}

describe('shutdown()', () => {
  it('closes the listener before the market-data provider', async () => {
    const server = fakeServer();
    await shutdown(server, fakeStore(server.calls), { log: () => {} });
    expect(server.calls).toEqual(['close', 'closeIdleConnections', 'store.close']);
  });

  it('closes the provider only once, however often the listener calls back', async () => {
    const server = fakeServer();
    const store = fakeStore(server.calls);
    await shutdown(server, store, { log: () => {} });
    await shutdown(server, store, { log: () => {} }); // a second call is a second shutdown
    expect(server.calls.filter((c) => c === 'store.close')).toHaveLength(2);
  });

  it('forces connections shut and still closes the provider when the grace period expires', async () => {
    // The listener never calls back: a request is in flight and stays there.
    const server = fakeServer({ closeCallsBack: false });
    const logged: string[] = [];
    await shutdown(server, fakeStore(server.calls), { timeoutMs: 10, log: (m) => logged.push(m) });
    expect(server.calls).toContain('closeAllConnections');
    expect(server.calls).toContain('store.close');
    // The forced path says so, because a shutdown that had to cut connections is
    // the one worth seeing in a container's logs.
    expect(logged.join('\n')).toMatch(/grace period expired/);
    server.drain(); // the late callback must not close the provider a second time
    expect(server.calls.filter((c) => c === 'store.close')).toHaveLength(1);
  });

  it('survives a provider that throws on close', async () => {
    const server = fakeServer();
    const store = { close(): void { throw new Error('handle already gone'); } };
    await expect(shutdown(server, store, { log: () => {} })).resolves.toBeUndefined();
  });

  it('does not wait out the grace period for an idle keep-alive connection', async () => {
    // The real failure this guards: `server.close()` alone never calls back while
    // a proxy holds an idle socket, so every Ctrl-C would cost the full window.
    const store = createUniverseStore(syntheticProvider(7));
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const agent = new Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/health', agent }, (res) => {
        res.resume();
        res.on('end', () => resolve());
      }).on('error', reject);
    });

    const started = performance.now();
    await shutdown(server, store, { timeoutMs: 5000, log: () => {} });
    expect(performance.now() - started).toBeLessThan(1000);
    agent.destroy();
  });
});

describe('installShutdownHandlers()', () => {
  // SIGUSR2 stands in for SIGTERM so the assertions cannot end the test runner.
  const SIGNAL = 'SIGUSR2' as NodeJS.Signals;
  afterEach(() => { process.removeAllListeners(SIGNAL); });

  it('shuts down on a signal and exits zero', async () => {
    const server = fakeServer();
    const codes: number[] = [];
    installShutdownHandlers(server, fakeStore(server.calls), {
      signals: [SIGNAL],
      exit: (c) => codes.push(c),
      log: () => {},
    });
    process.emit(SIGNAL, SIGNAL);
    await vi.waitFor(() => expect(codes).toEqual([0]));
    expect(server.calls).toContain('store.close');
  });

  it('exits non-zero on a second signal instead of waiting', async () => {
    // The listener is left hanging, so the first signal is still draining when
    // the second arrives — Ctrl-C twice means "stop waiting", and an exit that
    // skipped the drain should not report success.
    const server = fakeServer({ closeCallsBack: false });
    const codes: number[] = [];
    installShutdownHandlers(server, fakeStore(server.calls), {
      signals: [SIGNAL],
      timeoutMs: 60_000,
      exit: (c) => codes.push(c),
      log: () => {},
    });
    process.emit(SIGNAL, SIGNAL);
    process.emit(SIGNAL, SIGNAL);
    expect(codes).toEqual([1]);
    expect(server.calls).not.toContain('store.close');
  });
});
