import { describe, it, expect, vi } from 'vitest';
import { create } from 'zustand';
import { makeScreenerState, type ScreenerState } from './store';
import type { MarketClient, ScreenResp, SignalsRequest, SignalsResp, FanSignalRow } from './lib/client/marketClient';
import { DEFAULT_FAN_BACKTEST_CONFIG, type FanEntryEvent, type FanBacktestResult } from './lib/fanBacktest';
import type { InstrumentBars } from './lib/market';
import { STRATEGIES_KEY, memoryStorage, type StrategyStorage } from './lib/strategy/storage';
import { SCREENS_KEY, type SavedScreen } from './lib/screen/storage';
import { newCustomStrategy } from './lib/strategy/presets';
import { EMPTY_SNAPSHOT } from './lib/screen/snapshot';
import { DEFAULT_COLUMNS, DEFAULT_SORT } from './lib/screen/columns';
import { DOCK_DEFAULT, DOCK_MIN } from './lib/screen/dock';

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
      worstGap: 0.1, sparkline: [1, 2], snapshot: EMPTY_SNAPSHOT,
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

function makeStore(client: MarketClient, storage: StrategyStorage | null = null) {
  return create<ScreenerState>(makeScreenerState(client, storage));
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
        { ticker: 'A', name: 'A', sector: 'Tech', price: 50, changePct: 0, ema18: 4, ema50: 3, ema100: 2, ema200: 1, ema200Ago: { 21: 0.8, 63: 0.6, 105: 0.4 }, worstGap: 0.1, sparkline: [], snapshot: EMPTY_SNAPSHOT, avgVol20: 2e6, relVol: 1, marketCap: 10e9 },
        { ticker: 'B', name: 'B', sector: 'Energy', price: 8, changePct: 0, ema18: 4, ema50: 3, ema100: 2, ema200: 1, ema200Ago: { 21: 0.8, 63: 0.6, 105: 0.4 }, worstGap: 0.1, sparkline: [], snapshot: EMPTY_SNAPSHOT, avgVol20: 80_000, relVol: 1, marketCap: 200e6 },
      ],
      near: [],
    });
    store.getState().setClause({ field: 'avgVol20', kind: 'range', min: 250_000 });
    expect(store.getState().filteredMatches().map((r) => r.ticker)).toEqual(['A']);
    store.getState().setClause({ field: 'sector', kind: 'in', values: ['Energy'] });
    expect(store.getState().filteredMatches()).toEqual([]);
    store.getState().resetFilters();
    expect(store.getState().filteredMatches()).toHaveLength(2);
  });
});

describe('sort and columns', () => {
  it('defaults to worst-gap first for the fan lists and freshest for entries', () => {
    const store = makeStore(fakeClient());
    expect(store.getState().sort.fan).toEqual({ field: 'worstGap', dir: 'desc' });
    expect(store.getState().sort.entries).toEqual({ field: 'barsAgo', dir: 'asc' });
    expect(store.getState().columns.fan).toEqual(DEFAULT_COLUMNS.fan);
  });

  it('keeps each view\'s sort and columns independent', () => {
    const store = makeStore(fakeClient());
    store.getState().setSort('fan', { field: 'rsi14', dir: 'asc' });
    store.getState().toggleColumn('entries', 'rsi14');
    expect(store.getState().sort.fan).toEqual({ field: 'rsi14', dir: 'asc' });
    expect(store.getState().sort.entries).toEqual({ field: 'barsAgo', dir: 'asc' });
    expect(store.getState().columns.entries).not.toContain('rsi14');
    expect(store.getState().columns.fan).toContain('rsi14');
  });

  it('survives a re-run of the screen', async () => {
    const client = fakeClient();
    const store = makeStore(client);
    store.getState().setSort('fan', { field: 'relVol', dir: 'desc' });
    store.getState().toggleColumn('fan', 'ema18');
    const p = store.getState().runScreen();
    client.screenCalls[0].resolve(screenResp(['AAA', 'BBB']));
    await p;
    expect(store.getState().sort.fan).toEqual({ field: 'relVol', dir: 'desc' });
    expect(store.getState().columns.fan).not.toContain('ema18');
  });

  it('resets a view back to the default column set', () => {
    const store = makeStore(fakeClient());
    store.getState().toggleColumn('fan', 'ema18');
    store.getState().toggleColumn('fan', 'atrPct');
    expect(store.getState().columns.fan).not.toEqual(DEFAULT_COLUMNS.fan);
    store.getState().resetColumns('fan');
    expect(store.getState().columns.fan).toEqual(DEFAULT_COLUMNS.fan);
  });
});

describe('the visible tab and the detail dock', () => {
  it('starts on the fan tab with the default dock width', () => {
    const store = makeStore(fakeClient());
    expect(store.getState().view).toBe('fan');
    expect(store.getState().dockWidth).toBe(DOCK_DEFAULT);
  });

  it('follows the entry-strategy select onto the entries tab and back', () => {
    const store = makeStore(fakeClient({ signals: vi.fn(async (): Promise<SignalsResp> => (
      { universe: 1, elapsedMs: 1, strategy: 'tag50', strategyName: 'Tag 50', rows: [] }
    )) }));
    store.getState().setSignalStrategy('tag50');
    expect(store.getState().view).toBe('entries');
    store.getState().setSignalStrategy('');
    expect(store.getState().view).toBe('fan');
  });

  it('leaves a fan-side tab alone when the strategy is cleared', () => {
    const store = makeStore(fakeClient());
    store.getState().setView('near');
    store.getState().setSignalStrategy('');
    expect(store.getState().view).toBe('near');
  });

  it('clamps a dragged dock width to the panel minimum', () => {
    const store = makeStore(fakeClient());
    store.getState().setDockWidth(900);
    expect(store.getState().dockWidth).toBe(900);
    store.getState().setDockWidth(120);
    expect(store.getState().dockWidth).toBe(DOCK_MIN);
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
    avgVol20: 1e6, marketCap: 2e9, sparkline: [], snapshot: EMPTY_SNAPSHOT,
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
    store.getState().setClause({ field: 'avgVol20', kind: 'range', min: 250_000 });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].minAvgVol).toBe(250_000);
    // sector / price / indicator clauses are applied client-side, so they must
    // not move a floor and must not trigger a scan.
    store.getState().setClause({ field: 'sector', kind: 'in', values: ['Tech'] });
    store.getState().setClause({ field: 'price', kind: 'range', min: 5 });
    store.getState().setClause({ field: 'rsi14', kind: 'range', min: 50, max: 65 });
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

describe('saved strategies', () => {
  it('loads them from storage on init', () => {
    const mine = { ...newCustomStrategy('Mine'), id: 'custom-1' };
    const storage = memoryStorage(JSON.stringify([mine, { id: 'custom-broken', steps: [] }]));
    const store = makeStore(fakeClient(), storage);
    store.getState().init();
    expect(store.getState().strategies.map((d) => d.id)).toEqual(['custom-1']);
  });

  it('saveStrategy appends, then replaces, and persists the list', () => {
    const storage = memoryStorage();
    const store = makeStore(fakeClient(), storage);
    const mine = { ...newCustomStrategy('Mine'), id: 'custom-1' };
    store.getState().saveStrategy(mine);
    store.getState().saveStrategy({ ...mine, name: 'Renamed' });
    store.getState().saveStrategy({ ...newCustomStrategy('Other'), id: 'custom-2' });
    expect(store.getState().strategies.map((d) => d.name)).toEqual(['Renamed', 'Other']);
    const persisted = JSON.parse(storage.getItem(STRATEGIES_KEY) ?? '[]') as { id: string; name: string }[];
    expect(persisted.map((d) => d.id)).toEqual(['custom-1', 'custom-2']);
  });

  it('saveStrategy drops the builtin flag so the scan sends the definition', () => {
    const store = makeStore(fakeClient());
    store.getState().saveStrategy({ ...DEFAULT_FAN_BACKTEST_CONFIG.strategy, id: 'custom-1', name: 'From a preset' });
    expect(store.getState().strategies[0].builtin).toBeUndefined();
  });

  it('deleteStrategy forgets it, resets the modal to tag50 and turns the signal scan off', () => {
    const storage = memoryStorage();
    const store = makeStore(fakeClient(), storage);
    const mine = { ...newCustomStrategy('Mine'), id: 'custom-1' };
    store.getState().saveStrategy(mine);
    store.getState().setStrategyDef(mine);
    store.setState({ signalStrategy: 'custom-1' });

    store.getState().deleteStrategy('custom-1');
    expect(store.getState().strategies).toEqual([]);
    expect(JSON.parse(storage.getItem(STRATEGIES_KEY) ?? 'null')).toEqual([]);
    expect(store.getState().fanBacktest.config.strategy.id).toBe('tag50');
    expect(store.getState().signalStrategy).toBe('');
    expect(store.getState().signals).toEqual([]);
  });

  it('deleteStrategy leaves everything alone for an unknown id', () => {
    const store = makeStore(fakeClient());
    const mine = { ...newCustomStrategy('Mine'), id: 'custom-1' };
    store.getState().saveStrategy(mine);
    store.getState().setStrategyDef(mine);
    store.getState().deleteStrategy('nope');
    expect(store.getState().strategies).toHaveLength(1);
    expect(store.getState().fanBacktest.config.strategy.id).toBe('custom-1');
  });

  it('re-runs the scan when the strategy it is running is saved again', async () => {
    const calls: SignalsRequest[] = [];
    const client = fakeClient({
      signals: vi.fn(async (body: SignalsRequest): Promise<SignalsResp> => {
        calls.push(body);
        return { universe: 1, elapsedMs: 1, strategy: 'custom-1', strategyName: 'Mine', rows: [] };
      }),
    });
    const store = makeStore(client);
    const mine = { ...newCustomStrategy('Mine'), id: 'custom-1' };
    store.getState().saveStrategy(mine);
    store.getState().setSignalStrategy('custom-1');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    store.getState().saveStrategy({ ...mine, name: 'Mine v2' });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });
});

describe('saved screens', () => {
  function savedScreen(over: Partial<SavedScreen> = {}): SavedScreen {
    return {
      id: 'screen-1',
      name: 'Ema fan technical',
      savedAt: '2026-09-08T10:00:00.000Z',
      filters: { clauses: [
        { field: 'ema200Rising', kind: 'bars', bars: 21 },
        { field: 'avgVol20', kind: 'range', min: 400_000 },
      ] },
      sort: { field: 'rsi14', dir: 'asc' },
      columns: ['ticker', 'name', 'price', 'rsi14'],
      view: 'near',
      signalStrategy: '',
      ...over,
    };
  }
  const withScreens = (screens: SavedScreen[]) => memoryStorage(JSON.stringify(screens), SCREENS_KEY);

  it('writes the chips, the tab and that tab\'s columns and sort under a name', () => {
    const storage = memoryStorage();
    const store = makeStore(fakeClient(), storage);
    store.getState().setClause({ field: 'rsi14', kind: 'range', min: 50, max: 65 });
    store.getState().setSort('fan', { field: 'rsi14', dir: 'asc' });
    store.getState().toggleColumn('fan', 'ema18');
    store.getState().setView('near');
    store.getState().saveScreenAs('  Ema fan   technical  ');

    const [saved] = store.getState().screens;
    expect(saved.name).toBe('Ema fan technical');
    expect(saved.view).toBe('near');
    expect(saved.sort).toEqual({ field: 'rsi14', dir: 'asc' });
    expect(saved.columns).not.toContain('ema18');
    expect(saved.filters.clauses).toContainEqual({ field: 'rsi14', kind: 'range', min: 50, max: 65 });
    expect(store.getState().activeScreenId).toBe(saved.id);
    expect(JSON.parse(storage.getItem(SCREENS_KEY) ?? 'null')).toHaveLength(1);
  });

  it('lights Save up on a change and puts it out again when saved', () => {
    const store = makeStore(fakeClient(), memoryStorage());
    expect(store.getState().screenDirty()).toBe(false); // nothing loaded is not dirty
    store.getState().saveScreenAs('Mine');
    expect(store.getState().screenDirty()).toBe(false);
    store.getState().setClause({ field: 'price', kind: 'range', min: 20 });
    expect(store.getState().screenDirty()).toBe(true);
    store.getState().saveScreen();
    expect(store.getState().screenDirty()).toBe(false);
    expect(store.getState().screens).toHaveLength(1);
  });

  it('loads a screen back onto its tab, columns and sort', () => {
    const store = makeStore(fakeClient(), withScreens([savedScreen()]));
    store.getState().loadScreen('screen-1');
    expect(store.getState().view).toBe('near');
    expect(store.getState().columns.fan).toEqual(['ticker', 'name', 'price', 'rsi14']);
    expect(store.getState().sort.fan).toEqual({ field: 'rsi14', dir: 'asc' });
    expect(store.getState().filters.clauses).toHaveLength(2);
    expect(store.getState().screenDirty()).toBe(false);
  });

  it('restores the entry strategy first, so the tab it moves is the saved one', async () => {
    const calls: SignalsRequest[] = [];
    const client = fakeClient({
      signals: vi.fn(async (body: SignalsRequest): Promise<SignalsResp> => {
        calls.push(body);
        return { universe: 1, elapsedMs: 1, strategy: 'tag50', strategyName: 'Tag 50', rows: [] };
      }),
    });
    const store = makeStore(client, withScreens([savedScreen({ view: 'entries', signalStrategy: 'tag50' })]));
    store.getState().loadScreen('screen-1');
    expect(store.getState().signalStrategy).toBe('tag50');
    expect(store.getState().view).toBe('entries');
    // One scan, and it already carries the saved floors rather than the old ones.
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].minAvgVol).toBe(400_000);
  });

  it('drops an entry strategy that no longer exists rather than scanning for it', async () => {
    const client = fakeClient({ signals: vi.fn(async (): Promise<SignalsResp> => (
      { universe: 0, elapsedMs: 1, strategy: 'gone', strategyName: 'gone', rows: [] }
    )) });
    const store = makeStore(client, withScreens([savedScreen({ view: 'entries', signalStrategy: 'custom-gone' })]));
    store.getState().loadScreen('screen-1');
    expect(store.getState().signalStrategy).toBe('');
    expect(store.getState().signalsError).toBeNull();
    expect(client.signals).not.toHaveBeenCalled();
  });

  it('loads the default screen at start-up, and only that one', () => {
    const storage = withScreens([
      savedScreen({ id: 'a', name: 'Plain' }),
      savedScreen({ id: 'b', name: 'Default', default: true, view: 'fan', sort: { field: 'relVol', dir: 'desc' } }),
    ]);
    const store = makeStore(fakeClient(), storage);
    store.getState().init();
    expect(store.getState().activeScreenId).toBe('b');
    expect(store.getState().sort.fan).toEqual({ field: 'relVol', dir: 'desc' });
  });

  it('starts on the built-in screen when none is marked default', () => {
    const store = makeStore(fakeClient(), withScreens([savedScreen()]));
    store.getState().init();
    expect(store.getState().activeScreenId).toBeNull();
    expect(store.getState().view).toBe('fan');
    expect(store.getState().sort.fan).toEqual(DEFAULT_SORT.fan);
  });

  it('moves the default flag and persists it', () => {
    const storage = withScreens([savedScreen({ id: 'a' }), savedScreen({ id: 'b', default: true })]);
    const store = makeStore(fakeClient(), storage);
    store.getState().setDefaultScreen('a');
    expect(store.getState().screens.map((s) => s.default)).toEqual([true, undefined]);
    const persisted = JSON.parse(storage.getItem(SCREENS_KEY) ?? 'null') as SavedScreen[];
    expect(persisted.filter((s) => s.default)).toHaveLength(1);
  });

  it('renames, and refuses a name that is only spaces', () => {
    const store = makeStore(fakeClient(), withScreens([savedScreen()]));
    store.getState().renameScreen('screen-1', 'Ema fan fundamental');
    expect(store.getState().screens[0].name).toBe('Ema fan fundamental');
    store.getState().renameScreen('screen-1', '   ');
    expect(store.getState().screens[0].name).toBe('Ema fan fundamental');
  });

  it('deleting the loaded screen leaves the filters on screen, unattached', () => {
    const store = makeStore(fakeClient(), withScreens([savedScreen()]));
    store.getState().loadScreen('screen-1');
    store.getState().deleteScreen('screen-1');
    expect(store.getState().screens).toEqual([]);
    expect(store.getState().activeScreenId).toBeNull();
    expect(store.getState().filters.clauses).toHaveLength(2);
    expect(store.getState().screenDirty()).toBe(false);
  });

  it('New screen goes back to the defaults and detaches', () => {
    const store = makeStore(fakeClient(), withScreens([savedScreen()]));
    store.getState().loadScreen('screen-1');
    store.getState().newScreen();
    expect(store.getState().activeScreenId).toBeNull();
    expect(store.getState().view).toBe('fan');
    expect(store.getState().columns.fan).toEqual(DEFAULT_COLUMNS.fan);
    expect(store.getState().sort.fan).toEqual(DEFAULT_SORT.fan);
    expect(store.getState().filters.clauses).toEqual([{ field: 'ema200Rising', kind: 'bars', bars: 21 }]);
    expect(store.getState().signalStrategy).toBe('');
  });
});

describe('openFanBacktest copies screener liquidity filters', () => {
  it('seeds minAvgVol, minMarketCap, and 200-EMA slope from the main filter bar', () => {
    const store = makeStore(fakeClient());
    store.getState().setClause({ field: 'avgVol20', kind: 'range', min: 250_000 });
    store.getState().setClause({ field: 'marketCap', kind: 'range', min: 1e9 });
    store.getState().setClause({ field: 'ema200Rising', kind: 'bars', bars: 105 });
    store.getState().openFanBacktest();
    expect(store.getState().fanBacktest.config.minAvgVol).toBe(250_000);
    expect(store.getState().fanBacktest.config.minMarketCap).toBe(1e9);
    expect(store.getState().fanBacktest.config.ema200RisingBars).toBe(105);
  });
});
