import { create, type StateCreator } from 'zustand';
import * as M from './lib/market';
import type { Stock } from './lib/market';
import { httpMarketClient } from './lib/client/marketClient';
import type {
  MarketClient,
  FanRow,
  FanSignalRow,
  ImportConfigOption,
  ImportDataEntry,
  DevImportRequest,
  DevImportReport,
  DatabaseEntry,
} from './lib/client/marketClient';
import type { StrategyDef, ExitSpec } from './lib/strategy/types';
import { presetById, resolveStrategy } from './lib/strategy/presets';
import {
  browserStorage,
  loadStrategies,
  saveStrategies,
  type StrategyStorage,
} from './lib/strategy/storage';
import { signalFloorsOf, type Clause, type ScreenFilters } from './lib/screen/filters';
import { DEFAULT_COLUMNS, type ScreenView } from './lib/screen/columns';
import { setSectorOptions, type FieldId } from './lib/screen/fields';
import type { SortState } from './lib/screen/sort';
import { createScreenSlice, DEFAULT_SORT, type ScreenSlice } from './store/screenSlice';
import { createPortfolioSlice, type PortfolioSlice } from './store/portfolioSlice';
import type { SavedScreen } from './lib/screen/storage';
import {
  DEFAULT_FAN_BACKTEST_CONFIG,
  fanEntryIndex,
  type FanBacktestConfig,
  type FanBacktestProgress,
  type FanBacktestResult,
  type FanEntryEvent,
} from './lib/fanBacktest';

export type { FanRow, FanSignalRow, ImportConfigOption, ImportDataEntry, DevImportReport, DatabaseEntry };
export type { Clause, ScreenFilters, ScreenSlice };
export type { PortfolioSlice, PortfolioState, EditableHolding } from './store/portfolioSlice';
export type { FanBacktestConfig, FanBacktestProgress, FanBacktestResult, FanEntryEvent };
export type { StrategyDef, ExitSpec };
export type { ScreenView, FieldId, SortState, SavedScreen };
export { DEFAULT_FAN_BACKTEST_CONFIG, DEFAULT_COLUMNS, DEFAULT_SORT };

export type DisplayStatus = 'loading' | 'loaded' | 'error';

export interface DevImportState {
  available: boolean;
  open: boolean;
  configs: ImportConfigOption[];
  dataDir: string;
  dataEntries: ImportDataEntry[];
  targetDb: string;
  configName: string;
  configText: string;
  configDirty: boolean;
  inputMode: 'browse' | 'upload';
  selectedEntry: string;
  uploads: { name: string; content: string }[];
  uploadLabel: string;
  running: boolean;
  error: string | null;
  report: DevImportReport | null;
}

export interface DbSelectorState {
  available: boolean;
  databases: DatabaseEntry[];
  activeKind: 'synthetic' | 'sqlite';
  activePath: string | null;
  switching: boolean;
  error: string | null;
}

export interface FanBacktestState {
  open: boolean;
  running: boolean;
  error: string | null;
  progress: FanBacktestProgress | null;
  config: FanBacktestConfig;
  result: (FanBacktestResult & { elapsedMs: number }) | null;
  inspecting: FanEntryEvent | null;
}

const EMPTY_BACKTEST: FanBacktestState = {
  open: false,
  running: false,
  error: null,
  progress: null,
  config: { ...DEFAULT_FAN_BACKTEST_CONFIG },
  result: null,
  inspecting: null,
};

const EMPTY_IMPORT: DevImportState = {
  available: false, open: false,
  configs: [], dataDir: '', dataEntries: [], targetDb: '',
  configName: '', configText: '', configDirty: false,
  inputMode: 'browse', selectedEntry: '', uploads: [], uploadLabel: '',
  running: false, error: null, report: null,
};

const EMPTY_DB: DbSelectorState = {
  available: false, databases: [],
  activeKind: 'synthetic', activePath: null,
  switching: false, error: null,
};

export interface ScreenerState extends ScreenSlice, PortfolioSlice {
  ready: boolean;
  matches: FanRow[];
  near: FanRow[];
  screenLoading: boolean;
  screenError: string | null;
  universeSize: number;
  sectors: string[];
  /** Saved custom strategies (presets are not stored here). */
  strategies: StrategyDef[];
  /** '' = fan lists; a strategy id (preset or saved) switches the screener to the live-entries view. */
  signalStrategy: string;
  signals: FanSignalRow[];
  signalsLoading: boolean;
  signalsError: string | null;
  selected: string | null;
  displayed: Record<string, Stock>;
  displayStatus: Record<string, DisplayStatus>;
  devImport: DevImportState;
  dbSelector: DbSelectorState;
  fanBacktest: FanBacktestState;

  init: () => void;
  bootstrap: () => Promise<void>;
  retry: () => Promise<void>;
  runScreen: () => Promise<void>;
  setSignalStrategy: (strategy: string) => void;
  /** Insert or replace a saved custom strategy and persist the list. */
  saveStrategy: (def: StrategyDef) => void;
  /** Forget a saved strategy; anything selecting it falls back. */
  deleteStrategy: (id: string) => void;
  runSignals: () => Promise<void>;
  selectStock: (t: string) => void;
  closeDetail: () => void;
  ensureDisplayed: (ticker: string) => Promise<void>;
  retryDisplayed: (ticker: string) => void;

  probeDevImport: () => Promise<void>;
  openDevImport: () => void;
  closeDevImport: () => void;
  selectImportConfig: (name: string) => void;
  setImportConfigText: (text: string) => void;
  setImportMode: (mode: 'browse' | 'upload') => void;
  selectImportEntry: (path: string) => void;
  setImportUploads: (files: { name: string; content: string }[], label: string) => void;
  setImportTargetDb: (db: string) => void;
  runDevImport: () => Promise<void>;
  probeDatabases: () => Promise<void>;
  selectDatabase: (path: string | null) => Promise<void>;

  openFanBacktest: () => void;
  closeFanBacktest: () => void;
  setFanBacktestConfig: <K extends keyof FanBacktestConfig>(key: K, value: FanBacktestConfig[K]) => void;
  /** Replace the strategy under edit in the backtest modal. */
  setStrategyDef: (def: StrategyDef) => void;
  /** Patch the exit row of the strategy under edit. */
  patchExit: (patch: Partial<ExitSpec>) => void;
  runFanBacktest: () => Promise<void>;
  inspectFanEntry: (entry: FanEntryEvent) => void;
  stepFanTradeReview: (dir: -1 | 1) => void;
  closeFanTradeReview: () => void;
}

export function makeScreenerState(
  client: MarketClient = httpMarketClient(),
  storage: StrategyStorage | null = browserStorage(),
): StateCreator<ScreenerState> {
  let screenGen = 0;
  let screenAbort: AbortController | null = null;
  let signalsGen = 0;
  let signalsAbort: AbortController | null = null;
  let backtestGen = 0;
  let backtestAbort: AbortController | null = null;
  // Bumped on a database switch so an /instrument response that was in flight
  // against the old database is dropped instead of landing in the new state.
  let displayGen = 0;

  return (set, get) => ({
    // One storage object, two key spaces: saved strategies and saved screens.
    ...createScreenSlice(set, get, () => {
      if (get().signalStrategy) void get().runSignals();
    }, storage),
    // A third key space in the same storage object: the confirmed portfolio.
    ...createPortfolioSlice(set, get, client, storage),
    ready: false,
    matches: [],
    near: [],
    screenLoading: false,
    screenError: null,
    universeSize: 0,
    sectors: [],
    strategies: [],
    signalStrategy: '',
    signals: [],
    signalsLoading: false,
    signalsError: null,
    selected: null,
    displayed: {},
    displayStatus: {},
    devImport: { ...EMPTY_IMPORT },
    dbSelector: { ...EMPTY_DB },
    fanBacktest: { ...EMPTY_BACKTEST },

    init: () => {
      if (get().ready) return;
      set({ ready: true, strategies: loadStrategies(storage) });
      // After the strategies, so a saved screen's entry strategy resolves;
      // before the screen runs, so the first /signals scan carries its floors.
      get().applyDefaultScreen();
      void get().bootstrap();
      void get().runScreen();
      // Not gated on DEV: the screenshot reader is a product feature, and the
      // probe is what decides whether the UI offers it at all.
      void get().probePortfolio();
      if (import.meta.env.DEV) {
        void get().probeDevImport();
        void get().probeDatabases();
      }
    },

    bootstrap: async () => {
      try {
        const facts = await client.facts();
        set({ universeSize: facts.total, sectors: facts.sectors });
      } catch { /* runScreen surfaces the outage */ }
    },

    retry: async () => {
      await Promise.all([get().bootstrap(), get().runScreen()]);
    },

    runScreen: async () => {
      const gen = ++screenGen;
      screenAbort?.abort();
      const ac = new AbortController();
      screenAbort = ac;
      set({ screenLoading: true, screenError: null });
      try {
        const r = await client.screen(ac.signal);
        if (gen !== screenGen) return;
        const listed = new Set([...r.matches, ...r.near].map((row) => row.ticker));
        set((s) => ({
          matches: r.matches,
          near: r.near,
          universeSize: r.universe,
          screenLoading: false,
          selected: s.selected && listed.has(s.selected) ? s.selected : null,
        }));
      } catch {
        if (gen !== screenGen) return;
        set({
          screenLoading: false,
          screenError: 'Screening service unavailable — start it with `npm run dev`.',
        });
      }
    },

    setSignalStrategy: (strategy) => {
      // The tab follows the select: picking a strategy shows its entries,
      // clearing it drops back to the fan list rather than an empty tab.
      set((s) => ({
        signalStrategy: strategy,
        view: strategy ? 'entries' : s.view === 'entries' ? 'fan' : s.view,
      }));
      if (!strategy) {
        signalsGen++;
        signalsAbort?.abort();
        signalsAbort = null;
        set({ signals: [], signalsLoading: false, signalsError: null });
        return;
      }
      void get().runSignals();
    },
    saveStrategy: (def) => {
      const saved: StrategyDef = structuredClone(def);
      delete saved.builtin;
      const list = get().strategies;
      const at = list.findIndex((d) => d.id === saved.id);
      const next = at >= 0 ? list.map((d, k) => (k === at ? saved : d)) : [...list, saved];
      saveStrategies(storage, next);
      set({ strategies: next });
      // The scan is running the definition, not the name: re-run when the
      // selected strategy is the one that just changed.
      if (get().signalStrategy === saved.id) void get().runSignals();
    },
    deleteStrategy: (id) => {
      const list = get().strategies;
      const next = list.filter((d) => d.id !== id);
      if (next.length === list.length) return;
      saveStrategies(storage, next);
      set({ strategies: next });
      set((s) => (s.fanBacktest.config.strategy.id === id
        ? { fanBacktest: { ...s.fanBacktest, config: { ...s.fanBacktest.config, strategy: presetById('tag50') } } }
        : {}));
      if (get().signalStrategy === id) get().setSignalStrategy('');
    },
    runSignals: async () => {
      const strategy = get().signalStrategy;
      if (!strategy) return;
      const gen = ++signalsGen;
      signalsAbort?.abort();
      const ac = new AbortController();
      signalsAbort = ac;
      const { filters, strategies } = get();
      const def = resolveStrategy(strategy, strategies);
      if (!def) {
        set({ signals: [], signalsLoading: false, signalsError: `Unknown strategy "${strategy}".` });
        return;
      }
      set({ signalsLoading: true, signalsError: null });
      try {
        const resp = await client.signals({
          // Presets travel as their id; a saved strategy carries its definition.
          strategy: def.builtin ? def.id : def,
          ...signalFloorsOf(filters),
        }, ac.signal);
        if (gen !== signalsGen || get().signalStrategy !== strategy) return;
        set({ signals: resp.rows, signalsLoading: false });
      } catch (e) {
        if (gen !== signalsGen) return;
        if ((e as Error).name === 'AbortError') return;
        set({ signalsLoading: false, signalsError: 'Entry scan unavailable — start the service with `npm run dev`.' });
      }
    },
    selectStock: (t) => { set({ selected: t }); void get().ensureDisplayed(t); },
    closeDetail: () => set({ selected: null }),

    ensureDisplayed: async (ticker) => {
      if (!ticker || get().displayed[ticker]) return;
      if (get().displayStatus[ticker] === 'loading') return;
      set((s) => ({ displayStatus: { ...s.displayStatus, [ticker]: 'loading' } }));
      const gen = displayGen;
      try {
        const bars = await client.instrument(ticker);
        if (gen !== displayGen) return; // database switched underneath us
        if (!bars) {
          set((s) => ({ displayStatus: { ...s.displayStatus, [ticker]: 'error' } }));
          return;
        }
        const stock = M.buildStock(bars);
        set((s) => ({
          displayed: { ...s.displayed, [ticker]: stock },
          displayStatus: { ...s.displayStatus, [ticker]: 'loaded' },
        }));
      } catch {
        if (gen !== displayGen) return;
        set((s) => ({ displayStatus: { ...s.displayStatus, [ticker]: 'error' } }));
      }
    },
    retryDisplayed: (ticker) => {
      if (!ticker) return;
      const st = get();
      if (st.displayed[ticker]) return;
      if (st.displayStatus[ticker] === 'loading') return;
      set((s) => { const next = { ...s.displayStatus }; delete next[ticker]; return { displayStatus: next }; });
      void get().ensureDisplayed(ticker);
    },

    probeDevImport: async () => {
      const opts = await client.devImportOptions().catch(() => null);
      if (!opts) return;
      const first = opts.configs[0];
      set((s) => ({ devImport: { ...s.devImport,
        available: true,
        configs: opts.configs,
        dataDir: opts.dataDir,
        dataEntries: opts.dataEntries,
        targetDb: opts.targetDb,
        configName: first ? first.name : '',
        configText: first ? JSON.stringify(first.json, null, 2) : '',
        configDirty: false,
        selectedEntry: opts.dataEntries[0] ? opts.dataEntries[0].path : '',
      } }));
    },
    openDevImport: () => set((s) => ({ devImport: { ...s.devImport, open: true, error: null } })),
    closeDevImport: () => set((s) => ({ devImport: { ...s.devImport, open: false } })),
    selectImportConfig: (name) => set((s) => {
      const cfg = s.devImport.configs.find((c) => c.name === name);
      return { devImport: { ...s.devImport,
        configName: name,
        configText: cfg ? JSON.stringify(cfg.json, null, 2) : s.devImport.configText,
        configDirty: false,
      } };
    }),
    setImportConfigText: (text) => set((s) => ({ devImport: { ...s.devImport, configText: text, configDirty: true } })),
    setImportMode: (mode) => set((s) => ({ devImport: { ...s.devImport, inputMode: mode } })),
    selectImportEntry: (path) => set((s) => ({ devImport: { ...s.devImport, selectedEntry: path } })),
    setImportUploads: (files, label) => set((s) => ({ devImport: { ...s.devImport, uploads: files, uploadLabel: label } })),
    setImportTargetDb: (db) => set((s) => ({ devImport: { ...s.devImport, targetDb: db } })),
    runDevImport: async () => {
      const di = get().devImport;
      const patch = (p: Partial<DevImportState>) => set((s) => ({ devImport: { ...s.devImport, ...p } }));
      let configJson: unknown | undefined;
      if (di.configDirty) {
        try { configJson = JSON.parse(di.configText); }
        catch (e) { patch({ error: 'Config JSON is invalid: ' + (e as Error).message, report: null }); return; }
      }
      const req: DevImportRequest = { configName: di.configName, targetDb: di.targetDb };
      if (configJson !== undefined) req.configJson = configJson;
      if (di.inputMode === 'upload') {
        if (di.uploads.length === 0) { patch({ error: 'Choose one or more CSV files to upload.', report: null }); return; }
        req.uploads = di.uploads;
      } else {
        if (!di.selectedEntry) { patch({ error: 'Choose a file or folder to import.', report: null }); return; }
        req.inputPath = di.selectedEntry;
      }
      patch({ running: true, error: null, report: null });
      try {
        const report = await client.devImport(req);
        patch({ running: false, report });
        await Promise.all([get().bootstrap(), get().runScreen(), get().probeDatabases()]);
      } catch (e) {
        patch({ running: false, error: (e as Error).message });
      }
    },

    probeDatabases: async () => {
      const resp = await client.databases().catch(() => null);
      if (!resp) return;
      set((s) => ({ dbSelector: { ...s.dbSelector,
        available: true,
        databases: resp.databases,
        activeKind: resp.activeKind,
        activePath: resp.activePath,
        error: null,
      } }));
    },
    selectDatabase: async (path) => {
      const patch = (p: Partial<DbSelectorState>) => set((s) => ({ dbSelector: { ...s.dbSelector, ...p } }));
      patch({ switching: true, error: null });
      try {
        const report = await client.activateDatabase(path === null ? { synthetic: true } : { path });
        patch({ switching: false, activeKind: report.activeKind, activePath: report.activePath });
        displayGen++;
        set({ displayed: {}, displayStatus: {} });
        await Promise.all([get().bootstrap(), get().runScreen(), get().probeDatabases()]);
      } catch (e) {
        patch({ switching: false, error: (e as Error).message });
      }
    },

    openFanBacktest: () => {
      // Opening supersedes any run in flight: bump the generation so its
      // completion is dropped, abort the transport, and clear its partial state.
      // A finished result is kept so re-opening the modal shows the last run.
      backtestGen++;
      backtestAbort?.abort();
      backtestAbort = null;
      set((s) => ({
        fanBacktest: {
          ...s.fanBacktest,
          open: true,
          running: false,
          error: null,
          progress: null,
          result: s.fanBacktest.running ? null : s.fanBacktest.result,
          config: { ...s.fanBacktest.config, ...signalFloorsOf(s.filters) },
        },
      }));
    },
    closeFanBacktest: () => {
      backtestGen++;
      backtestAbort?.abort();
      backtestAbort = null;
      set((s) => ({ fanBacktest: { ...s.fanBacktest, open: false, running: false, progress: null, inspecting: null } }));
    },
    setFanBacktestConfig: (key, value) => set((s) => ({
      fanBacktest: { ...s.fanBacktest, config: { ...s.fanBacktest.config, [key]: value } },
    })),
    setStrategyDef: (def) => set((s) => ({
      fanBacktest: { ...s.fanBacktest, config: { ...s.fanBacktest.config, strategy: def } },
    })),
    patchExit: (patch) => set((s) => {
      const strategy = s.fanBacktest.config.strategy;
      const next: StrategyDef = { ...strategy, trade: { ...strategy.trade, exit: { ...strategy.trade.exit, ...patch } } };
      return { fanBacktest: { ...s.fanBacktest, config: { ...s.fanBacktest.config, strategy: next } } };
    }),
    inspectFanEntry: (entry) => {
      set((s) => ({ fanBacktest: { ...s.fanBacktest, inspecting: entry } }));
      void get().ensureDisplayed(entry.ticker);
    },
    stepFanTradeReview: (dir) => {
      const { inspecting, result } = get().fanBacktest;
      if (!inspecting || !result) return;
      const i = fanEntryIndex(result.entries, inspecting);
      const next = result.entries[i + dir];
      if (next) get().inspectFanEntry(next);
    },
    closeFanTradeReview: () => set((s) => ({ fanBacktest: { ...s.fanBacktest, inspecting: null } })),
    runFanBacktest: async () => {
      const gen = ++backtestGen;
      backtestAbort?.abort();
      const ac = new AbortController();
      backtestAbort = ac;
      const config = get().fanBacktest.config;
      set((s) => ({
        fanBacktest: { ...s.fanBacktest, running: true, error: null, progress: null, result: null, inspecting: null },
      }));
      try {
        const result = await client.backtest(config, (p) => {
          if (gen !== backtestGen) return;
          set((s) => ({ fanBacktest: { ...s.fanBacktest, progress: p } }));
        }, ac.signal);
        if (gen !== backtestGen) return;
        set((s) => ({ fanBacktest: { ...s.fanBacktest, running: false, result } }));
      } catch (e) {
        if (gen !== backtestGen) return;
        const msg = (e as Error).name === 'AbortError'
          ? null
          : ((e as Error).message || 'Backtest failed');
        set((s) => ({ fanBacktest: { ...s.fanBacktest, running: false, error: msg } }));
      }
    },
  });
}

export const useScreener = create<ScreenerState>(makeScreenerState());

// The sector chip's choices are whatever the loaded dataset reported.
setSectorOptions(() => useScreener.getState().sectors);
