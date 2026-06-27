// store.test.ts — first client-side store tests (STORY-035 AC#6). Exercises the
// store's service orchestration with an INJECTED fake MarketClient (no network),
// proving the seam from STORY-035 makes the data flow unit-testable. Covers:
// stale-generation responses are dropped (last-write-wins), the `screenError`
// banner is set on failure, and `displayed[]` caches by ticker (one fetch/name).

import { describe, it, expect, vi } from 'vitest';
import { create } from 'zustand';
import { makeScreenerState, type ScreenerState } from './store';
import type { MarketClient, ScreenResp } from './lib/client/marketClient';
import type { InstrumentBars } from './lib/market';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function screenResp(tickers: string[]): ScreenResp {
  return { total: tickers.length, count: tickers.length, offset: 0, limit: 0, elapsedMs: 1, tickers, results: [] };
}

const BARS: InstrumentBars = {
  ticker: 'AAPL', name: 'Apple', sector: 'Tech',
  bars: Array.from({ length: 5 }, (_, i) => ({ o: i + 1, h: i + 2, l: i, c: i + 1.5, v: 100 + i })),
};

// A fake client whose `screen` hands back controllable deferreds (and records
// the AbortSignal each call received, so tests can assert the store cancels a
// superseded request), plus stubs for the rest of the seam.
type FakeClient = MarketClient & {
  screenCalls: ReturnType<typeof deferred<ScreenResp>>[];
  screenSignals: (AbortSignal | undefined)[];
};
function fakeClient(overrides: Partial<MarketClient> = {}): FakeClient {
  const screenCalls: ReturnType<typeof deferred<ScreenResp>>[] = [];
  const screenSignals: (AbortSignal | undefined)[] = [];
  return {
    screenCalls,
    screenSignals,
    facts: async () => ({ total: 0, sectors: [], sample: null }),
    instrument: async () => null,
    screen: vi.fn((_rules, _limit, signal?: AbortSignal) => {
      screenSignals.push(signal);
      const d = deferred<ScreenResp>();
      screenCalls.push(d);
      return d.promise;
    }),
    backtest: async () => null,
    devImportOptions: async () => null,
    devImport: async () => ({ files: 0, instruments: 0, bars: 0, skipped: 0, errors: [], targetDb: '', universe: 0 }),
    databases: async () => null,
    activateDatabase: async () => ({ activeKind: 'synthetic', activePath: null, universe: 0 }),
    ...overrides,
  };
}

function makeStore(client: MarketClient) {
  return create<ScreenerState>(makeScreenerState(client));
}

describe('runScreen generation guard', () => {
  it('drops a stale (superseded) response and aborts it so the newest run wins', async () => {
    const client = fakeClient();
    const store = makeStore(client);

    const p1 = store.getState().runScreen(); // gen 1
    const p2 = store.getState().runScreen(); // gen 2 — supersedes gen 1
    expect(client.screenCalls).toHaveLength(2);

    // The superseded (gen 1) request must have been cancelled by the store; the
    // current (gen 2) request must still be live. This exercises the abort half
    // of the orchestration, not just the generation guard.
    expect(client.screenSignals[0]?.aborted).toBe(true);
    expect(client.screenSignals[1]?.aborted).toBe(false);

    // Newer run settles first and commits…
    client.screenCalls[1].resolve(screenResp(['NEW']));
    await p2;
    expect(store.getState().screen?.tickers).toEqual(['NEW']);

    // …then the older (stale) run settles and must NOT overwrite it.
    client.screenCalls[0].resolve(screenResp(['OLD']));
    await p1;
    expect(store.getState().screen?.tickers).toEqual(['NEW']);
  });

  it('sequences each store independently (per-store counters, not module scope)', async () => {
    // STORY-035 moved the generation counters into the per-store factory closure.
    // Two live stores must NOT cross-cancel: store A's second run must not abort
    // store B's in-flight run, and each commits its own result.
    const a = fakeClient();
    const b = fakeClient();
    const storeA = makeStore(a);
    const storeB = makeStore(b);

    const pA = storeA.getState().runScreen();
    const pB = storeB.getState().runScreen();
    // A second run on A bumps only A's counter/abort — B is untouched.
    const pA2 = storeA.getState().runScreen();

    expect(a.screenSignals[0]?.aborted).toBe(true);  // A's first, superseded
    expect(b.screenSignals[0]?.aborted).toBe(false); // B's only run, still live

    b.screenCalls[0].resolve(screenResp(['B']));
    a.screenCalls[1].resolve(screenResp(['A']));
    a.screenCalls[0].resolve(screenResp(['A-stale'])); // superseded — must be dropped
    await Promise.all([pA, pA2, pB]);

    expect(storeA.getState().screen?.tickers).toEqual(['A']);
    expect(storeB.getState().screen?.tickers).toEqual(['B']);
  });
});

describe('runScreen failure', () => {
  it('sets the screenError banner and clears loading when the client throws', async () => {
    const client = fakeClient();
    const store = makeStore(client);

    // Seed a previously-committed screen so "screen is preserved" is a real
    // assertion, not a tautology against the null initial state.
    const seed = store.getState().runScreen();
    client.screenCalls[0].resolve(screenResp(['SEED']));
    await seed;
    expect(store.getState().screen?.tickers).toEqual(['SEED']);

    const p = store.getState().runScreen();
    expect(store.getState().screenLoading).toBe(true);
    client.screenCalls[1].reject(new Error('service down'));
    await p;

    expect(store.getState().screenError).toMatch(/unavailable/i);
    expect(store.getState().screenLoading).toBe(false);
    // The failed run must not wipe the user's visible results table.
    expect(store.getState().screen?.tickers).toEqual(['SEED']);
  });
});

describe('ensureDisplayed caching', () => {
  it('builds and caches a Stock by ticker, fetching each name only once', async () => {
    const instrument = vi.fn(async () => BARS);
    const store = makeStore(fakeClient({ instrument }));

    await store.getState().ensureDisplayed('AAPL');
    await store.getState().ensureDisplayed('AAPL'); // cached — no second fetch

    expect(instrument).toHaveBeenCalledTimes(1);
    expect(store.getState().displayed['AAPL']).toBeDefined();
    expect(store.getState().displayed['AAPL'].ticker).toBe('AAPL');
  });

  it('does not cache when the name is unknown (404 → null)', async () => {
    const instrument = vi.fn(async () => null);
    const store = makeStore(fakeClient({ instrument }));

    await store.getState().ensureDisplayed('NOPE');

    expect(instrument).toHaveBeenCalledTimes(1);
    expect(store.getState().displayed['NOPE']).toBeUndefined();
  });
});
