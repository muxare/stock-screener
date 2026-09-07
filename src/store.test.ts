import { describe, it, expect, vi } from 'vitest';
import { create } from 'zustand';
import { makeScreenerState, type ScreenerState } from './store';
import type { MarketClient, ScreenResp, SignalsRequest, SignalsResp, FanSignalRow } from './lib/client/marketClient';
import { DEFAULT_FAN_BACKTEST_CONFIG, type FanEntryEvent, type FanBacktestResult } from './lib/fanBacktest';
import type { InstrumentBars } from './lib/market';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function screenResp(tickers: string[]): ScreenResp {
  return {
    universe: tickers.length,
    elapsedMs: 1,
    matches: tickers.map((t) => ({
      ticker: t, name: t, sector: 'Tech', price: 1, changePct: 0,
      ema18: 4, ema50: 3, ema100: 2, ema200: 1, ema200Ago: { 21: 0.8, 63: 0.6, 105: 0.4 },
      worstGap: 0.1, sparkline: [1, 2],
      avgVol20: 500_000, relVol: 1, marketCap: 1e9,
    })),
    near: [],
  };
}

const BARS: InstrumentBars = {
  ticker: 'AAPL', name: 'Apple', sector: 'Tech',
  bars: Array.from({ length: 5 }, (_, i) => ({ o: i + 1, h: i + 2, l: i, c: i + 1.5, v: 100 + i })),
};

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
    screen: vi.fn((signal?: AbortSignal) => {
      screenSignals.push(signal);
      const d = deferred<ScreenResp>();
      screenCalls.push(d);
      return d.promise;
    }),
    backtest: vi.fn(async () => ({
      elapsedMs: 1,
      config: { ...DEFAULT_FAN_BACKTEST_CONFIG, horizons: [5] },
      universe: 1,
      stocksScanned: 1,
      totalEntries: 0,
      stocksWithEntries: 0,
      forwardHorizons: [],
      trades: { count: 0, winRate: 0, avgReturnPct: 0, medianReturnPct: 0, avgR: 0, medianR: 0, hitTargetPct: 0, avgBarsHeld: 0, byExitReason: {} },
      entries: [],
      factors: [],
      account: {
        startCash: 10_000, endEquity: 10_000, returnPct: 0, maxDrawdownPct: 0,
        taken: 0, skipped: { total: 0, noCash: 0, maxPositions: 0 },
        endReason: 'window' as const, windowStart: null, windowEnd: null,
        candidates: 0, curve: [], fills: [],
      },
    })),
    signals: async () => ({ universe: 0, elapsedMs: 1, strategy: 'onset', strategyName: 'Fan onset (baseline)', rows: [] }),
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
  it('drops a stale response and aborts it so the newest run wins', async () => {
    const client = fakeClient();
    const store = makeStore(client);

    const p1 = store.getState().runScreen();
    const p2 = store.getState().runScreen();
    expect(client.screenCalls).toHaveLength(2);
    expect(client.screenSignals[0]?.aborted).toBe(true);
    expect(client.screenSignals[1]?.aborted).toBe(false);

    client.screenCalls[1].resolve(screenResp(['NEW']));
    await p2;
    expect(store.getState().matches.map((r) => r.ticker)).toEqual(['NEW']);

    client.screenCalls[0].resolve(screenResp(['OLD']));
    await p1;
    expect(store.getState().matches.map((r) => r.ticker)).toEqual(['NEW']);
  });

  it('sets screenError when the service fails', async () => {
    const client = fakeClient();
    const store = makeStore(client);
    const p = store.getState().runScreen();
    client.screenCalls[0].reject(new Error('down'));
    await p;
    expect(store.getState().screenError).toMatch(/unavailable/);
  });
});

describe('fan filters', () => {
  it('filters matches by volume and sector', () => {
    const client = fakeClient();
    const store = makeStore(client);
    store.setState({
      matches: [
        { ticker: 'A', name: 'A', sector: 'Tech', price: 50, changePct: 0, ema18: 4, ema50: 3, ema100: 2, ema200: 1, ema200Ago: { 21: 0.8, 63: 0.6, 105: 0.4 }, worstGap: 0.1, sparkline: [], avgVol20: 2e6, relVol: 1, marketCap: 10e9 },
        { ticker: 'B', name: 'B', sector: 'Energy', price: 8, changePct: 0, ema18: 4, ema50: 3, ema100: 2, ema200: 1, ema200Ago: { 21: 0.8, 63: 0.6, 105: 0.4 }, worstGap: 0.1, sparkline: [], avgVol20: 80_000, relVol: 1, marketCap: 200e6 },
      ],
      near: [],
    });
    store.getState().setFilter('minAvgVol', 250_000);
    expect(store.getState().filteredMatches().map((r) => r.ticker)).toEqual(['A']);
    store.getState().setFilter('sector', 'Energy');
    expect(store.getState().filteredMatches()).toEqual([]);
    store.getState().resetFilters();
    expect(store.getState().filteredMatches()).toHaveLength(2);
  });
});

describe('ensureDisplayed', () => {
  it('caches a built stock after one instrument fetch', async () => {
    const client = fakeClient({ instrument: vi.fn(async () => BARS) });
    const store = makeStore(client);
    await store.getState().ensureDisplayed('AAPL');
    await store.getState().ensureDisplayed('AAPL');
    expect(client.instrument).toHaveBeenCalledTimes(1);
    expect(store.getState().displayed.AAPL?.ticker).toBe('AAPL');
    expect(store.getState().displayStatus.AAPL).toBe('loaded');
  });

  it('marks error when instrument returns null', async () => {
    const store = makeStore(fakeClient({ instrument: async () => null }));
    await store.getState().ensureDisplayed('NOPE');
    expect(store.getState().displayStatus.NOPE).toBe('error');
  });

  it('drops bars that arrive after a database switch', async () => {
    const d = deferred<InstrumentBars | null>();
    const store = makeStore(fakeClient({
      instrument: vi.fn(() => d.promise),
      screen: async () => screenResp([]), // selectDatabase awaits a fresh screen
    }));
    const pending = store.getState().ensureDisplayed('AAPL');
    await store.getState().selectDatabase('/somewhere/other.db');
    d.resolve(BARS);
    await pending;
    expect(store.getState().displayed.AAPL).toBeUndefined();
    expect(store.getState().displayStatus.AAPL).toBeUndefined();
  });
});

describe('openFanBacktest while a run is in flight', () => {
  it('supersedes the run: running clears, the aborted run leaves no result or error', async () => {
    const d = deferred<FanBacktestResult & { elapsedMs: number }>();
    const store = makeStore(fakeClient({ backtest: vi.fn(() => d.promise) }));
    store.getState().openFanBacktest();
    const run = store.getState().runFanBacktest();
    expect(store.getState().fanBacktest.running).toBe(true);
    store.getState().openFanBacktest();
    expect(store.getState().fanBacktest.running).toBe(false);
    d.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await run;
    expect(store.getState().fanBacktest.running).toBe(false);
    expect(store.getState().fanBacktest.result).toBeNull();
    expect(store.getState().fanBacktest.error).toBeNull();
  });
});

describe('inspectFanEntry', () => {
  it('opens a trade review and loads bars for that ticker', async () => {
    const client = fakeClient({ instrument: vi.fn(async () => BARS) });
    const store = makeStore(client);
    store.getState().inspectFanEntry({
      ticker: 'AAPL', name: 'Apple', date: '2017-09-07', barIndex: 2,
      strategyId: 'tag50', strategyName: '50-EMA tag', entryMode: 'close', summary: '',
      entryPrice: 10, worstGap: 0, forwardReturns: {},
      trade: {
        entryBar: 2, exitBar: 4, entryPrice: 10, exitPrice: 11, stopPrice: 9, targetPrice: 13,
        returnPct: 10, realizedR: 1, barsHeld: 2, maxFavorablePct: 12, maxAdversePct: -1, exitReason: 'trail',
      },
      marks: [], fanBar: 1, reactionBar: 2, impulseBar: 1, indicators: null,
    });
    expect(store.getState().fanBacktest.inspecting?.ticker).toBe('AAPL');
    await vi.waitFor(() => expect(store.getState().displayed.AAPL).toBeTruthy());
    expect(client.instrument).toHaveBeenCalledWith('AAPL');
    store.getState().closeFanTradeReview();
    expect(store.getState().fanBacktest.inspecting).toBeNull();
  });

  it('steps previous/next through the current result list', () => {
    const store = makeStore(fakeClient());
    const a: FanEntryEvent = {
      ticker: 'AAA', name: 'A', date: '2016-01-01', barIndex: 10,
      strategyId: 'tag50', strategyName: '50-EMA tag', entryMode: 'close', summary: '',
      entryPrice: 1, worstGap: 0, forwardReturns: {},
      trade: null, marks: [], fanBar: 8, reactionBar: 10, impulseBar: 9, indicators: null,
    };
    const b: FanEntryEvent = { ...a, ticker: 'BBB', name: 'B', barIndex: 20, reactionBar: 20, fanBar: 18 };
    const result = {
      config: store.getState().fanBacktest.config,
      universe: 2, stocksScanned: 2, totalEntries: 2, stocksWithEntries: 2,
      forwardHorizons: [], trades: {
        count: 0, winRate: 0, avgReturnPct: 0, medianReturnPct: 0, avgR: 0, medianR: 0,
        hitTargetPct: 0, avgBarsHeld: 0, byExitReason: {},
      },
      entries: [a, b],
      factors: [],
      account: {
        startCash: 10_000, endEquity: 10_000, returnPct: 0, maxDrawdownPct: 0,
        taken: 0, skipped: { total: 0, noCash: 0, maxPositions: 0 },
        endReason: 'window' as const, windowStart: null, windowEnd: null,
        candidates: 0, curve: [], fills: [],
      },
      elapsedMs: 1,
    } satisfies FanBacktestResult & { elapsedMs: number };
    store.setState({ fanBacktest: { ...store.getState().fanBacktest, result, inspecting: b } });
    store.getState().stepFanTradeReview(-1);
    expect(store.getState().fanBacktest.inspecting?.ticker).toBe('AAA');
    store.getState().stepFanTradeReview(1);
    expect(store.getState().fanBacktest.inspecting?.ticker).toBe('BBB');
    store.getState().stepFanTradeReview(1);
    expect(store.getState().fanBacktest.inspecting?.ticker).toBe('BBB');
  });
});

function signalRow(ticker: string): FanSignalRow {
  return {
    ticker, name: ticker, sector: 'Tech', price: 50, changePct: 0,
    strategy: 'tag50', entryDate: '2026-01-05', barsAgo: 1,
    entryPrice: 50, stopPrice: 48, riskPerShare: 2, riskPct: 4,
    targetLoR: 2.5, targetHiR: 3, targetLoPrice: 55, targetHiPrice: 56, openR: 0.3,
    avgVol20: 1e6, marketCap: 2e9, sparkline: [],
  };
}

describe('live entry signals', () => {
  it('runs a scan when a strategy is chosen and clears when turned off', async () => {
    const calls: SignalsRequest[] = [];
    const client = fakeClient({
      signals: vi.fn(async (body: SignalsRequest): Promise<SignalsResp> => {
        calls.push(body);
        const id = typeof body.strategy === 'string' ? body.strategy : body.strategy.id;
        return { universe: 3, elapsedMs: 1, strategy: id, strategyName: id, rows: [signalRow('AAA')] };
      }),
    });
    const store = makeStore(client);
    store.getState().setSignalStrategy('tag50');
    await vi.waitFor(() => expect(store.getState().signals.map((r) => r.ticker)).toEqual(['AAA']));
    expect(calls[0].strategy).toBe('tag50');
    store.getState().setSignalStrategy('');
    expect(store.getState().signals).toEqual([]);
    expect(store.getState().signalsError).toBeNull();
  });

  it('re-runs on a scan filter change but not on a client-side facet', async () => {
    const calls: SignalsRequest[] = [];
    const client = fakeClient({
      signals: vi.fn(async (body: SignalsRequest): Promise<SignalsResp> => {
        calls.push(body);
        const id = typeof body.strategy === 'string' ? body.strategy : body.strategy.id;
        return { universe: 3, elapsedMs: 1, strategy: id, strategyName: id, rows: [] };
      }),
    });
    const store = makeStore(client);
    store.getState().setSignalStrategy('tag50');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    store.getState().setFilter('minAvgVol', 250_000);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].minAvgVol).toBe(250_000);
    // sector / min-price are applied client-side, so they must not trigger a scan.
    store.getState().setFilter('sector', 'Tech');
    store.getState().setFilter('minPrice', 5);
    await Promise.resolve();
    expect(calls).toHaveLength(2);
  });

  it('sends a saved custom strategy as its definition and an unknown id as an error', async () => {
    const calls: SignalsRequest[] = [];
    const client = fakeClient({
      signals: vi.fn(async (body: SignalsRequest): Promise<SignalsResp> => {
        calls.push(body);
        const id = typeof body.strategy === 'string' ? body.strategy : body.strategy.id;
        return { universe: 3, elapsedMs: 1, strategy: id, strategyName: id, rows: [] };
      }),
    });
    const store = makeStore(client);
    const mine = { ...DEFAULT_FAN_BACKTEST_CONFIG.strategy, id: 'mine', name: 'Mine', builtin: undefined };
    store.setState({ strategies: [mine] });
    store.getState().setSignalStrategy('mine');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(typeof calls[0].strategy).toBe('object');
    expect((calls[0].strategy as { id: string }).id).toBe('mine');
    store.getState().setSignalStrategy('ghost');
    await vi.waitFor(() => expect(store.getState().signalsError).toMatch(/Unknown strategy/));
    expect(calls).toHaveLength(1);
  });

  it('sets signalsError when the scan fails', async () => {
    const client = fakeClient({ signals: vi.fn(async () => { throw new Error('down'); }) });
    const store = makeStore(client);
    store.getState().setSignalStrategy('tag50');
    await vi.waitFor(() => expect(store.getState().signalsError).toMatch(/unavailable/));
  });
});

describe('strategy editing in the backtest modal', () => {
  it('setStrategyDef replaces the def and patchExit edits only the exit row', () => {
    const store = makeStore(fakeClient());
    const before = store.getState().fanBacktest.config.strategy;
    store.getState().patchExit({ trailEma: null, targetR: 2 });
    const after = store.getState().fanBacktest.config.strategy;
    expect(after.trade.exit.trailEma).toBeNull();
    expect(after.trade.exit.targetR).toBe(2);
    expect(after.steps).toBe(before.steps);
    expect(after.trade.stop).toEqual(before.trade.stop);
    store.getState().setStrategyDef({ ...before, id: 'x', name: 'X' });
    expect(store.getState().fanBacktest.config.strategy.id).toBe('x');
  });
});

describe('openFanBacktest copies screener liquidity filters', () => {
  it('seeds minAvgVol, minMarketCap, and 200-EMA slope from the main filter bar', () => {
    const store = makeStore(fakeClient());
    store.getState().setFilter('minAvgVol', 250_000);
    store.getState().setFilter('minMarketCap', 1e9);
    store.getState().setFilter('ema200RisingBars', 105);
    store.getState().openFanBacktest();
    expect(store.getState().fanBacktest.config.minAvgVol).toBe(250_000);
    expect(store.getState().fanBacktest.config.minMarketCap).toBe(1e9);
    expect(store.getState().fanBacktest.config.ema200RisingBars).toBe(105);
  });
});
