// shutdown.test.ts — graceful shutdown (platform hardening phase 1.2, carried
// across to Fastify by phase 2.1).
//
// The leak this closes is invisible from the outside: `UniverseStore.close()`
// existed and was never called, so every restart of the dev server abandoned the
// SQLite read handle. What is worth pinning is therefore not "does it close" alone
// but the order and the deadline — the provider must outlive the requests that are
// still reading from it, and a shutdown must not be able to hang forever waiting
// for a keep-alive socket that the Vite dev proxy will hold open all day.
//
// Fastify changed the shape of the first half: `app.close()` is a promise that
// resolves once the listener is down, where `http.Server.close()` was a callback.
// The guarantees below are unchanged, which is the point of testing them.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Agent, get } from 'node:http';
import { createUniverseStore } from './universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { startApp } from './testHarness.ts';
import { shutdown, installShutdownHandlers } from './shutdown.ts';

// A stand-in for the slice of Fastify `shutdown` uses, recording the call order so
// the provider-after-listener guarantee can be asserted directly.
function fakeApp(opts: { closeResolves?: boolean } = {}) {
  const { closeResolves = true } = opts;
  const calls: string[] = [];
  let pending: (() => void) | null = null;
  return {
    calls,
    // Release an app.close() that was deliberately left hanging.
    drain(): void { const cb = pending; pending = null; cb?.(); },
    close(): Promise<void> {
      calls.push('close');
      // A real Fastify close never resolves synchronously — it resolves once the
      // last connection ends — and the fake would otherwise report an ordering the
      // production path cannot produce.
      if (closeResolves) return Promise.resolve();
      return new Promise<void>((resolve) => { pending = resolve; });
    },
    server: {
      closeIdleConnections(): void { calls.push('closeIdleConnections'); },
      closeAllConnections(): void { calls.push('closeAllConnections'); },
    },
  };
}

function fakeStore(calls: string[], onClose?: () => void) {
  return { close(): void { calls.push('store.close'); onClose?.(); } };
}

describe('shutdown()', () => {
  it('closes the listener before the market-data provider', async () => {
    const app = fakeApp();
    await shutdown(app, fakeStore(app.calls), { log: () => {} });
    expect(app.calls).toEqual(['close', 'closeIdleConnections', 'store.close']);
  });

  it('closes the provider only once, however often the listener calls back', async () => {
    const app = fakeApp();
    const store = fakeStore(app.calls);
    await shutdown(app, store, { log: () => {} });
    await shutdown(app, store, { log: () => {} }); // a second call is a second shutdown
    expect(app.calls.filter((c) => c === 'store.close')).toHaveLength(2);
  });

  it('forces connections shut and still closes the provider when the grace period expires', async () => {
    // The listener never resolves: a request is in flight and stays there.
    const app = fakeApp({ closeResolves: false });
    const logged: string[] = [];
    await shutdown(app, fakeStore(app.calls), { timeoutMs: 10, log: (m) => logged.push(m) });
    expect(app.calls).toContain('closeAllConnections');
    expect(app.calls).toContain('store.close');
    // The forced path says so, because a shutdown that had to cut connections is
    // the one worth seeing in a container's logs.
    expect(logged.join('\n')).toMatch(/grace period expired/);
    app.drain(); // the late resolution must not close the provider a second time
    await Promise.resolve();
    expect(app.calls.filter((c) => c === 'store.close')).toHaveLength(1);
  });

  it('survives a provider that throws on close', async () => {
    const app = fakeApp();
    const store = { close(): void { throw new Error('handle already gone'); } };
    await expect(shutdown(app, store, { log: () => {} })).resolves.toBeUndefined();
  });

  it('does not wait out the grace period for an idle keep-alive connection', async () => {
    // The real failure this guards: a listener close that waits for every open
    // connection never completes while a proxy holds an idle socket, so every
    // Ctrl-C would cost the full window.
    const store = createUniverseStore(syntheticProvider(7));
    const { app, base } = await startApp(store);
    const port = Number(new URL(base).port);

    const agent = new Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/health', agent }, (res) => {
        res.resume();
        res.on('end', () => resolve());
      }).on('error', reject);
    });

    const started = performance.now();
    await shutdown(app, store, { timeoutMs: 5000, log: () => {} });
    expect(performance.now() - started).toBeLessThan(1000);
    agent.destroy();
  });
});

describe('installShutdownHandlers()', () => {
  // SIGUSR2 stands in for SIGTERM so the assertions cannot end the test runner.
  const SIGNAL = 'SIGUSR2' as NodeJS.Signals;
  afterEach(() => { process.removeAllListeners(SIGNAL); });

  it('shuts down on a signal and exits zero', async () => {
    const app = fakeApp();
    const codes: number[] = [];
    installShutdownHandlers(app, fakeStore(app.calls), {
      signals: [SIGNAL],
      exit: (c) => codes.push(c),
      log: () => {},
    });
    process.emit(SIGNAL, SIGNAL);
    await vi.waitFor(() => expect(codes).toEqual([0]));
    expect(app.calls).toContain('store.close');
  });

  it('exits non-zero on a second signal instead of waiting', async () => {
    // The listener is left hanging, so the first signal is still draining when
    // the second arrives — Ctrl-C twice means "stop waiting", and an exit that
    // skipped the drain should not report success.
    const app = fakeApp({ closeResolves: false });
    const codes: number[] = [];
    installShutdownHandlers(app, fakeStore(app.calls), {
      signals: [SIGNAL],
      timeoutMs: 60_000,
      exit: (c) => codes.push(c),
      log: () => {},
    });
    process.emit(SIGNAL, SIGNAL);
    process.emit(SIGNAL, SIGNAL);
    expect(codes).toEqual([1]);
    expect(app.calls).not.toContain('store.close');
  });
});
