import { create } from 'zustand';
import * as M from './lib/market';
import { syntheticProvider } from './lib/data/synthetic';
import type {
  Stock,
  IndicatorDef,
  IndicatorType,
  Rule,
  RankRule,
  Screen,
  Preset,
} from './lib/market';

// ----------------------------------------------------------------------------
// This store is a faithful port of the POC's single `class Component extends
// DCLogic` (see poc/Stock Screener.dc.html). State fields and action names
// mirror the original. React-event handlers from the POC are translated to
// actions that take the raw value (string) — components pass e.target.value.
// ----------------------------------------------------------------------------

const PALETTE = ['#e2649b', '#13b8b0', '#7b61ff', '#d9871f', '#3aa0ff', '#06a96b', '#e2553d', '#9b51e0'];
const STORE = 'screenr.indicators.v1';
const SCREENS = 'screenr.screens.v1';
const VIEW = 'screenr.view.v1';
const PINS = 'screenr.pins.v1';
const ALERTS = 'screenr.alerts.v1';
const PSTORE = 'screenr.presets.v1';

const uid = (p: string) => p + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
const uid6 = (p: string) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

// ---------- draft / view-model types (UI-only, not part of the domain model) ----------
export type RhsType = 'const' | 'price' | 'ind';
export interface RuleDraft {
  leftId: string | null;
  op: string;
  rhsType: RhsType;
  value: number | string;
  rightId: string | null;
  min: number | string;
  max: number | string;
}
export interface BuilderDraft {
  type: IndicatorType;
  source: string;
  length: number | string;
  fast: number | string;
  slow: number | string;
  signal: number | string;
  output: string;
  rsiLen: number | string;
  stochLen: number | string;
  kSmooth: number | string;
  dSmooth: number | string;
  name: string;
  nameTouched: boolean;
  [key: string]: unknown;
}
export type OperandDraft = {
  kind: 'field' | 'ind' | 'const';
  field?: string;
  id?: string;
  offset?: number | string;
  value?: number | string;
  mult?: number | string;
  add?: number | string;
};
export interface CondDraft {
  left: OperandDraft;
  op: string;
  right: OperandDraft;
  conj: 'and' | 'or';
}
export interface ScreenDraft {
  name: string;
  nameTouched: boolean;
  conds: CondDraft[];
}
export interface PatternDraft { pat: string; n: number | string }
export interface RankDraft { field: string; scope: string; dir: string; pct: number | string }
export interface PresetStore {
  custom: Preset[];
  overrides: Record<string, Partial<Preset>>;
  hidden: string[];
}
export interface Diff {
  entered: string[];
  exited: string[];
  alerts: { name: string; count: number }[];
}
export type Panels = { ema: boolean; volume: boolean; macd: boolean; rsi: boolean; stoch: boolean; markers: boolean };

// ---------- localStorage helpers ----------
function load<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v == null ? fallback : (v as T);
  } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function freshBuilder(type: IndicatorType): BuilderDraft {
  const base = { source: 'close', length: 21, fast: 12, slow: 26, signal: 9, output: 'line', rsiLen: 14, stochLen: 14, kSmooth: 3, dSmooth: 3 };
  return { type, ...base, ...((M.IND_DEFAULTS as Record<string, object>)[type] || {}), name: '', nameTouched: false } as BuilderDraft;
}
function builderFromInd(ind: IndicatorDef): BuilderDraft {
  const base = { source: 'close', length: 21, fast: 12, slow: 26, signal: 9, output: 'line', rsiLen: 14, stochLen: 14, kSmooth: 3, dSmooth: 3 };
  return { ...base, ...ind, name: (ind as { name?: string }).name ?? '', nameTouched: true } as BuilderDraft;
}
function defFromBuilder(b: BuilderDraft): IndicatorDef {
  const clamp = (v: unknown, dflt: number, min: number, max: number) => {
    let n = parseInt(String(v), 10);
    if (isNaN(n)) n = dflt;
    return Math.max(min, Math.min(max, n));
  };
  const d: Record<string, unknown> = { type: b.type, source: b.source };
  if (b.type === 'ema' || b.type === 'sma') d.length = clamp(b.length, 21, 2, 400);
  else if (b.type === 'rsi') d.length = clamp(b.length, 14, 2, 100);
  else if (b.type === 'macd') { d.fast = clamp(b.fast, 12, 2, 100); d.slow = clamp(b.slow, 26, 3, 300); d.signal = clamp(b.signal, 9, 1, 100); d.output = b.output; }
  else if (b.type === 'stochrsi') { d.rsiLen = clamp(b.rsiLen, 14, 2, 100); d.stochLen = clamp(b.stochLen, 14, 2, 100); d.kSmooth = clamp(b.kSmooth, 3, 1, 20); d.dSmooth = clamp(b.dSmooth, 3, 1, 20); d.output = b.output; }
  return d as unknown as IndicatorDef;
}
function freshCond(inds: IndicatorDef[]): CondDraft {
  const right: OperandDraft = inds[0]
    ? { kind: 'ind', id: (inds[0] as { id: string }).id, offset: 0 }
    : { kind: 'const', value: 0 };
  return { left: { kind: 'field', field: 'close', offset: 0 }, op: 'gt', right, conj: 'and' };
}
function freshScreen(inds: IndicatorDef[]): ScreenDraft {
  return { name: '', nameTouched: false, conds: [freshCond(inds)] };
}

// swap any operand/def referencing indicator `id` for the updated indicator
function replaceIndInRule(rule: Rule, id: string, newInd: IndicatorDef): Rule {
  const fixOp = (op: unknown) => {
    const o = op as { kind?: string; def?: { id?: string } } | null;
    return (o && o.kind === 'ind' && o.def && o.def.id === id) ? { ...o, def: { ...newInd } } : op;
  };
  const r = rule as unknown as Record<string, unknown> & { kind: string };
  if (r.kind === 'group') return { ...r, conds: (r.conds as { left: unknown; right: unknown }[]).map((c) => ({ ...c, left: fixOp(c.left), right: fixOp(c.right) })) } as Rule;
  if (r.kind === 'chain') return { ...r, operands: (r.operands as { type?: string; def?: { id?: string } }[]).map((o) => (o.type === 'ind' && o.def && o.def.id === id) ? { ...o, def: { ...newInd } } : o) } as Rule;
  if (r.kind === 'ind') {
    const out = { ...r } as Record<string, unknown>;
    const left = out.left as { id?: string } | undefined;
    if (left && left.id === id) out.left = { ...newInd };
    const rhs = out.rhs as { type?: string; def?: { id?: string } } | undefined;
    if (rhs && rhs.type === 'ind' && rhs.def && rhs.def.id === id) out.rhs = { ...rhs, def: { ...newInd } };
    return out as unknown as Rule;
  }
  return rule;
}

// ----------------------------------------------------------------------------

export interface ScreenerState {
  // ---- core state (mirrors POC `state`) ----
  ready: boolean;
  universe: Stock[];
  activePreset: string;
  customRules: Rule[];
  search: string;
  sectorFilter: string;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  selected: string | null;
  layout: 'overlay' | 'docked';
  density: 'comfortable' | 'compact';
  panels: Panels;
  savedIndicators: IndicatorDef[];
  builderOpen: boolean;
  builder: BuilderDraft;
  editingIndId: string | null;
  editingScreenId: string | null;
  rule: RuleDraft;
  savedScreens: Screen[];
  screenBuilderOpen: boolean;
  screenDraft: ScreenDraft | null;
  pcfOpen: boolean;
  pcfText: string;
  pcfError: string;
  mathOpen: Record<string, boolean>;
  patternDraft: PatternDraft;
  ruleOpen: boolean;
  patternOpen: boolean;
  pinned: string[];
  seed: number;
  compareSel: string[];
  compareOpen: boolean;
  backtestOpen: boolean;
  backtestResult: M.BacktestResult | null;
  rankOpen: boolean;
  rankDraft: RankDraft;
  heatmapOpen: boolean;
  alertScreens: Record<string, boolean>;
  diff: Diff | null;
  presetStore: PresetStore;
  editingPreset: string | null;
  presetName: string;
  presetDesc: string;
  editChip: number | null;

  // ---- lifecycle ----
  init: () => void;

  // ---- derived (read current state via get()) ----
  presets: () => Preset[];
  presetById: (id: string) => Preset;
  effectiveRules: () => Rule[];
  /** rules passed to the detail panel — rank rules annotated with `_pass` for the selected stock */
  detailRules: () => Rule[];
  /** universe filtered by the active screen (preset + grouped custom + rank), pre sector/search */
  screenList: () => Stock[];
  /** screenList then sector + search filter + sort + pin-to-top */
  filteredStocks: () => Stock[];
  ruleLabel: (r: Rule) => string;
  specOf: (ind: IndicatorDef) => string;
  trendOf: (s: Stock) => [string, string, string];

  // ---- indicator builder ----
  openBuilder: () => void;
  editIndicator: (id: string) => void;
  closeBuilder: () => void;
  setBuilderType: (type: IndicatorType) => void;
  onBuilderParam: (key: string, value: string) => void;
  onBuilderName: (value: string) => void;
  saveIndicator: () => void;
  deleteIndicator: (id: string) => void;

  // ---- setup (condition-group) builder ----
  openScreenBuilder: () => void;
  closeScreenBuilder: () => void;
  editScreen: (scr: Screen) => void;
  setCondSrc: (idx: number, side: 'left' | 'right', value: string) => void;
  setCondOffset: (idx: number, side: 'left' | 'right', value: string) => void;
  setCondConst: (idx: number, side: 'left' | 'right', value: string) => void;
  setCondOp: (idx: number, value: string) => void;
  toggleCondConj: (idx: number) => void;
  addCond: () => void;
  removeCond: (idx: number) => void;
  loadExample: () => void;
  toggleMath: (idx: number, side: 'left' | 'right') => void;
  setCondMult: (idx: number, side: 'left' | 'right', value: string) => void;
  setCondAdd: (idx: number, side: 'left' | 'right', value: string) => void;
  togglePcf: () => void;
  onPcfText: (value: string) => void;
  onParsePCF: () => void;
  onScreenName: (value: string) => void;
  saveScreen: () => void;
  applyScreen: (scr: Screen) => void;
  deleteScreen: (id: string) => void;
  screenRule: (draft: ScreenDraft) => Rule | null;

  // ---- rule builder ----
  onRuleLeft: (value: string) => void;
  onRuleOp: (value: string) => void;
  onRuleRhsType: (value: string) => void;
  onRuleValue: (value: string) => void;
  onRuleRight: (value: string) => void;
  onRuleMin: (value: string) => void;
  onRuleMax: (value: string) => void;
  addRule: () => void;
  addFlag: (field: string) => void;

  // ---- patterns ----
  onPatternType: (value: string) => void;
  onPatternN: (value: string) => void;
  addPattern: () => void;

  // ---- presets ----
  setPreset: (id: string) => void;
  clearAll: () => void;
  removeRule: (i: number) => void;
  editPreset: (id: string) => void;
  newPreset: () => void;
  onPresetName: (value: string) => void;
  onPresetDesc: (value: string) => void;
  savePreset: () => void;
  cancelPresetEdit: () => void;
  resetPreset: () => void;
  deletePreset: () => void;

  // ---- chip editing ----
  openChipEdit: (i: number) => void;
  closeChipEdit: () => void;
  patchRule: (i: number, patch: Partial<Rule>, relabel?: (r: Rule) => string) => void;
  onChipNum: (i: number, key: string, value: string) => void;
  onChipPatternN: (i: number, value: string) => void;
  onChipRank: (i: number, key: string, value: string) => void;
  onChipIndConst: (i: number, value: string) => void;
  toggleRuleConj: (i: number) => void;

  // ---- view / misc handlers ----
  onSearch: (value: string) => void;
  onSector: (value: string) => void;
  setSort: (k: string) => void;
  selectStock: (t: string) => void;
  closeDetail: () => void;
  setLayout: (l: 'overlay' | 'docked') => void;
  togglePanel: (k: keyof Panels) => void;
  toggleRuleSection: () => void;
  togglePatternSection: () => void;
  togglePin: (t: string) => void;
  setDensity: (d: 'comfortable' | 'compact') => void;

  // ---- ranking ----
  toggleRankSection: () => void;
  onRankField: (value: string) => void;
  onRankScope: (value: string) => void;
  onRankDir: (value: string) => void;
  onRankPct: (value: string) => void;
  addRank: () => void;

  // ---- compare ----
  toggleCompare: (t: string) => void;
  openCompare: () => void;
  closeCompare: () => void;
  clearCompare: () => void;

  // ---- backtest / heatmap / alerts / refresh ----
  openBacktest: () => void;
  closeBacktest: () => void;
  toggleHeatmap: () => void;
  toggleAlert: (id: string) => void;
  refreshData: () => void;
  dismissDiff: () => void;
}

export const useScreener = create<ScreenerState>((set, get) => {
  const saveView = () => {
    const s = get();
    save(VIEW, { activePreset: s.activePreset, sortKey: s.sortKey, sortDir: s.sortDir, density: s.density, layout: s.layout, sectorFilter: s.sectorFilter });
  };
  const savePresetStore = (o: PresetStore) => save(PSTORE, o);

  const presetByIdFrom = (ps: PresetStore, id: string): Preset => {
    const ov = ps.overrides[id];
    const bi = M.PRESETS.find((p) => p.id === id);
    if (bi) return (ov ? { ...bi, ...ov } : bi) as Preset;
    return (ps.custom || []).find((p) => p.id === id) || ({ rules: [] } as unknown as Preset);
  };

  return {
    // ---- initial state ----
    ready: false,
    universe: [],
    activePreset: 'macdmomo',
    customRules: [],
    search: '',
    sectorFilter: 'all',
    sortKey: 'changePct',
    sortDir: 'desc',
    selected: null,
    layout: 'overlay',
    density: 'comfortable',
    panels: { ema: true, volume: true, macd: true, rsi: true, stoch: true, markers: true },
    savedIndicators: [],
    builderOpen: false,
    builder: freshBuilder('ema'),
    editingIndId: null,
    editingScreenId: null,
    rule: { leftId: null, op: 'gt', rhsType: 'const', value: 0, rightId: null, min: 0, max: 0 },
    savedScreens: [],
    screenBuilderOpen: false,
    screenDraft: null,
    pcfOpen: false,
    pcfText: '',
    pcfError: '',
    mathOpen: {},
    patternDraft: { pat: 'consec_down', n: 3 },
    ruleOpen: false,
    patternOpen: false,
    pinned: [],
    seed: 7,
    compareSel: [],
    compareOpen: false,
    backtestOpen: false,
    backtestResult: null,
    rankOpen: false,
    rankDraft: { field: 'relVol', scope: 'all', dir: 'top', pct: 10 },
    heatmapOpen: false,
    alertScreens: {},
    diff: null,
    presetStore: { custom: [], overrides: {}, hidden: [] },
    editingPreset: null,
    presetName: '',
    presetDesc: '',
    editChip: null,

    // ---- lifecycle ----
    init: () => {
      if (get().ready) return;
      const saved = load<IndicatorDef[]>(STORE, []);
      const ps = load<Partial<PresetStore>>(PSTORE, {});
      const presetStore: PresetStore = { custom: ps.custom || [], overrides: ps.overrides || {}, hidden: ps.hidden || [] };
      const view = load<Record<string, unknown>>(VIEW, {});
      const viewOk: Record<string, unknown> = {};
      (['activePreset', 'sortKey', 'sortDir', 'density', 'layout', 'sectorFilter'] as const).forEach((k) => { if (view[k] != null) viewOk[k] = view[k]; });
      set({
        ready: true,
        universe: M.buildUniverse(syntheticProvider(7).getUniverse()),
        savedIndicators: saved,
        savedScreens: load<Screen[]>(SCREENS, []),
        builder: freshBuilder('ema'),
        rule: { ...get().rule, leftId: saved.length ? (saved[0] as { id: string }).id : null },
        pinned: load<string[]>(PINS, []),
        alertScreens: load<Record<string, boolean>>(ALERTS, {}),
        presetStore,
        ...viewOk,
      });
    },

    // ---- derived ----
    presets: () => {
      const ps = get().presetStore;
      const hidden = new Set(ps.hidden || []);
      const builtins = M.PRESETS.filter((p) => !hidden.has(p.id)).map((p) =>
        ps.overrides[p.id] ? ({ ...p, ...ps.overrides[p.id], id: p.id, builtin: true, overridden: true } as Preset) : ({ ...p, builtin: true } as Preset));
      const custom = (ps.custom || []).map((p) => ({ ...p, builtin: false } as Preset));
      return [...builtins, ...custom];
    },
    presetById: (id) => get().presets().find((p) => p.id === id) || ({ rules: [] } as unknown as Preset),
    effectiveRules: () => {
      const preset = get().presetById(get().activePreset);
      return [...preset.rules, ...get().customRules];
    },
    detailRules: () => {
      const st = get();
      const preset = st.presetById(st.activePreset);
      const selectedStock = st.universe.find((s) => s.ticker === st.selected) || null;
      return [...preset.rules, ...st.customRules.map((rr) => {
        if ((rr as { kind: string }).kind !== 'rank') return rr;
        const pass = M.rankPassSet(st.universe, rr as RankRule);
        return { ...rr, _pass: selectedStock ? pass.has(selectedStock.ticker) : false } as unknown as Rule;
      })];
    },
    screenList: () => {
      const st = get();
      const preset = st.presetById(st.activePreset);
      const rankRules = st.customRules.filter((rr) => (rr as { kind: string }).kind === 'rank') as RankRule[];
      const others = st.customRules.filter((rr) => (rr as { kind: string }).kind !== 'rank');
      const grouped = [...preset.rules, ...others];
      let listed = st.universe.filter((s) => M.evalGroupedRules(s, grouped));
      for (const rr of rankRules) { const pass = M.rankPassSet(st.universe, rr); listed = listed.filter((s) => pass.has(s.ticker)); }
      return listed;
    },
    filteredStocks: () => {
      const st = get();
      const q = st.search.trim().toLowerCase();
      let list = st.screenList();
      if (st.sectorFilter !== 'all') list = list.filter((s) => s.sector === st.sectorFilter);
      if (q) list = list.filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
      list = list.slice().sort((a, b) => {
        const va = (a as Record<string, unknown>)[st.sortKey];
        const vb = (b as Record<string, unknown>)[st.sortKey];
        const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return st.sortDir === 'asc' ? cmp : -cmp;
      });
      const pinnedSet = new Set(st.pinned);
      if (pinnedSet.size) list = [...list.filter((s) => pinnedSet.has(s.ticker)), ...list.filter((s) => !pinnedSet.has(s.ticker))];
      return list;
    },
    ruleLabel: (r) => {
      const k = (r as { kind: string }).kind;
      if (k === 'group') return (r as { name?: string }).name || M.groupLabel(r as never);
      if (k === 'chain') return (r as { name?: string }).name || M.chainLabel(r as never);
      if (k === 'pattern') return (r as { name?: string }).name || M.patternLabel(r as never);
      if (k === 'rank') return (r as { name?: string }).name || M.rankLabel(r as never);
      if (k === 'ind') return M.indRuleLabel(r as never);
      const F = M.FIELDS as Record<string, { label: string; unit: string }>;
      const FL = M.FLAGS as Record<string, string>;
      const rr = r as { field: string; op?: string; value?: number; min?: number; max?: number };
      if (k === 'flag') return FL[rr.field];
      const f = F[rr.field];
      const u = f.unit;
      if (rr.op === 'gt') return `${f.label} > ${rr.value}${u}`;
      if (rr.op === 'lt') return `${f.label} < ${rr.value}${u}`;
      if (rr.op === 'between') return `${f.label} ${rr.min}–${rr.max}${u}`;
      return f.label;
    },
    specOf: (ind) => {
      const i = ind as Record<string, unknown> & { type: string; source: string };
      const t = i.type;
      if (t === 'ema' || t === 'sma' || t === 'rsi') return `${i.source} · length ${i.length}`;
      if (t === 'macd') return `${i.source} · ${i.fast}/${i.slow}/${i.signal} · ${i.output}`;
      if (t === 'stochrsi') return `${i.source} · ${i.rsiLen}/${i.stochLen}/${i.kSmooth}/${i.dSmooth} · ${i.output === 'd' ? '%D' : '%K'}`;
      return i.source;
    },
    trendOf: (s) => {
      if (s.ema20 > s.ema50 && s.ema50 > s.ema200) return ['Strong up', '#06a96b', '#e7f6ef'];
      if (s.ema50 > s.ema200) return ['Uptrend', '#06a96b', '#e7f6ef'];
      if (s.ema20 < s.ema50 && s.ema50 < s.ema200) return ['Downtrend', '#e23d3d', '#fdeceb'];
      return ['Mixed', '#8b9298', '#f1f2f3'];
    },

    // ---- indicator builder ----
    openBuilder: () => set({ builderOpen: true, editingIndId: null, builder: freshBuilder('ema') }),
    editIndicator: (id) => {
      const ind = get().savedIndicators.find((i) => (i as { id: string }).id === id);
      if (!ind) return;
      set({ builderOpen: true, editingIndId: id, builder: builderFromInd(ind) });
    },
    closeBuilder: () => set({ builderOpen: false, editingIndId: null }),
    setBuilderType: (type) => set({ builder: freshBuilder(type) }),
    onBuilderParam: (key, value) => set((st) => ({ builder: { ...st.builder, [key]: value } })),
    onBuilderName: (value) => set((st) => ({ builder: { ...st.builder, name: value, nameTouched: true } })),
    saveIndicator: () => {
      const st = get();
      const b = st.builder;
      const def = defFromBuilder(b);
      const name = (b.nameTouched && b.name.trim()) ? b.name.trim() : M.autoIndName(def);
      const editId = st.editingIndId;
      if (editId) {
        const prev = st.savedIndicators.find((i) => (i as { id: string }).id === editId) as { color?: string } | undefined;
        const ind = { id: editId, name, color: prev?.color, ...def } as IndicatorDef;
        const list = st.savedIndicators.map((i) => ((i as { id: string }).id === editId ? ind : i));
        save(STORE, list);
        const screens = st.savedScreens.map((s) => ({ ...s, rule: replaceIndInRule(s.rule, editId, ind) }));
        save(SCREENS, screens);
        set({
          savedIndicators: list, savedScreens: screens, builderOpen: false, editingIndId: null,
          customRules: st.customRules.map((r) => replaceIndInRule(r, editId, ind)),
        });
        return;
      }
      const id = uid('ind');
      const color = PALETTE[st.savedIndicators.length % PALETTE.length];
      const ind = { id, name, color, ...def } as IndicatorDef;
      const list = [...st.savedIndicators, ind];
      save(STORE, list);
      set({ savedIndicators: list, builderOpen: false, rule: { ...st.rule, leftId: st.rule.leftId || id } });
    },
    deleteIndicator: (id) => {
      const st = get();
      const list = st.savedIndicators.filter((i) => (i as { id: string }).id !== id);
      save(STORE, list);
      set({
        savedIndicators: list,
        customRules: st.customRules.filter((r) => {
          const rr = r as { kind: string; left?: { id?: string }; rhs?: { type?: string; def?: { id?: string } } };
          return !(rr.kind === 'ind' && (rr.left?.id === id || (rr.rhs && rr.rhs.type === 'ind' && rr.rhs.def?.id === id)));
        }),
        rule: {
          ...st.rule,
          leftId: st.rule.leftId === id ? ((list[0] as { id?: string })?.id ?? null) : st.rule.leftId,
          rightId: st.rule.rightId === id ? null : st.rule.rightId,
        },
      });
    },

    // ---- setup (condition-group) builder ----
    screenRule: (draft) => {
      const inds = get().savedIndicators;
      const resolve = (op: OperandDraft) => {
        if (!op) return null;
        if (op.kind === 'const') return { kind: 'const', value: Number(op.value) || 0 };
        const offset = Math.max(0, parseInt(String(op.offset), 10) || 0);
        const mult = (op.mult == null || op.mult === '') ? 1 : Number(op.mult);
        const add = (op.add == null || op.add === '') ? 0 : Number(op.add);
        if (op.kind === 'field') return { kind: 'field', field: op.field, offset, mult, add };
        const ind = inds.find((i) => (i as { id: string }).id === op.id);
        return ind ? { kind: 'ind', def: { ...ind }, offset, mult, add } : null;
      };
      const conds = (draft.conds || []).map((c) => {
        const left = resolve(c.left), right = resolve(c.right);
        if (!left || !right) return null;
        return { left, op: c.op, right, conj: c.conj || 'and' };
      });
      if (!conds.length || conds.some((c) => !c)) return null;
      return { kind: 'group', conds } as Rule;
    },
    openScreenBuilder: () => set((st) => ({ screenBuilderOpen: true, editingScreenId: null, pcfOpen: false, pcfError: '', mathOpen: {}, screenDraft: freshScreen(st.savedIndicators) })),
    closeScreenBuilder: () => set({ screenBuilderOpen: false, editingScreenId: null }),
    editScreen: (scr) => {
      const st = get();
      const inds = st.savedIndicators.slice();
      const ensure = (def: IndicatorDef) => {
        const sig = M.defSig(def);
        const found = inds.find((i) => M.defSig(i) === sig);
        if (found) return (found as { id: string }).id;
        const id = uid6('ind');
        const color = PALETTE[inds.length % PALETTE.length];
        inds.push({ id, name: M.autoIndName(def), color, ...def } as IndicatorDef);
        return id;
      };
      const opToDraft = (op: { kind?: string; type?: string; value?: unknown; field?: string; offset?: number; mult?: unknown; add?: unknown; def?: IndicatorDef } | null): OperandDraft => {
        if (!op) return { kind: 'const', value: 0 };
        if (op.kind === 'const' || op.type === 'const') return { kind: 'const', value: op.value as number };
        if (op.kind === 'field') return { kind: 'field', field: op.field, offset: op.offset || 0, mult: op.mult as number, add: op.add as number };
        if (op.type === 'price') return { kind: 'field', field: 'close', offset: 0 };
        return { kind: 'ind', id: ensure(op.def as IndicatorDef), offset: op.offset || 0, mult: op.mult as number, add: op.add as number };
      };
      let conds: CondDraft[];
      const rule = scr.rule as unknown as Record<string, unknown> & { kind: string };
      if (rule.kind === 'group') {
        conds = (rule.conds as { left: unknown; op: string; right: unknown; conj?: string }[]).map((c) => ({ left: opToDraft(c.left as never), op: c.op, right: opToDraft(c.right as never), conj: (c.conj as 'and' | 'or') || 'and' }));
      } else { // migrate an old monotonic chain into the condition model
        const ops = rule.operands as IndicatorDef[];
        const link = rule.ops as string[];
        conds = link.map((o, k) => ({ left: opToDraft(ops[k] as never), op: o === 'lt' ? 'lt' : 'gt', right: opToDraft(ops[k + 1] as never), conj: 'and' as const }));
      }
      if (inds.length !== st.savedIndicators.length) save(STORE, inds);
      set({ savedIndicators: inds, screenBuilderOpen: true, editingScreenId: scr.id, screenDraft: { name: scr.name, nameTouched: true, conds }, pcfOpen: false, pcfError: '', mathOpen: {} });
    },
    setCondSrc: (idx, side, v) => set((st) => {
      if (!st.screenDraft) return {};
      const conds = st.screenDraft.conds.slice();
      const c = { ...conds[idx] };
      const op = { ...c[side] };
      let next: OperandDraft;
      if (v === 'const') next = { kind: 'const', value: op.value != null ? op.value : 0 };
      else if (v.indexOf('field:') === 0) next = { kind: 'field', field: v.slice(6), offset: op.offset || 0 };
      else next = { kind: 'ind', id: v.slice(4), offset: op.offset || 0 };
      c[side] = next;
      conds[idx] = c;
      return { screenDraft: { ...st.screenDraft, conds } };
    }),
    setCondOffset: (idx, side, v) => set((st) => {
      if (!st.screenDraft) return {};
      const conds = st.screenDraft.conds.slice();
      const c = { ...conds[idx] }; c[side] = { ...c[side], offset: v }; conds[idx] = c;
      return { screenDraft: { ...st.screenDraft, conds } };
    }),
    setCondConst: (idx, side, v) => set((st) => {
      if (!st.screenDraft) return {};
      const conds = st.screenDraft.conds.slice();
      const c = { ...conds[idx] }; c[side] = { ...c[side], value: v }; conds[idx] = c;
      return { screenDraft: { ...st.screenDraft, conds } };
    }),
    setCondOp: (idx, v) => set((st) => {
      if (!st.screenDraft) return {};
      const conds = st.screenDraft.conds.slice(); conds[idx] = { ...conds[idx], op: v };
      return { screenDraft: { ...st.screenDraft, conds } };
    }),
    toggleCondConj: (idx) => set((st) => {
      if (!st.screenDraft) return {};
      const conds = st.screenDraft.conds.slice(); conds[idx] = { ...conds[idx], conj: conds[idx].conj === 'or' ? 'and' : 'or' };
      return { screenDraft: { ...st.screenDraft, conds } };
    }),
    addCond: () => set((st) => st.screenDraft ? ({ screenDraft: { ...st.screenDraft, conds: [...st.screenDraft.conds, freshCond(st.savedIndicators)] } }) : {}),
    removeCond: (idx) => set((st) => {
      if (!st.screenDraft || st.screenDraft.conds.length <= 1) return {};
      return { screenDraft: { ...st.screenDraft, conds: st.screenDraft.conds.filter((_, i) => i !== idx) } };
    }),
    loadExample: () => set({ screenDraft: {
      name: '', nameTouched: false,
      conds: [
        { left: { kind: 'field', field: 'high', offset: 0 }, op: 'lt', right: { kind: 'field', field: 'high', offset: 1 }, conj: 'and' },
        { left: { kind: 'field', field: 'close', offset: 0 }, op: 'gt', right: { kind: 'field', field: 'open', offset: 0 }, conj: 'and' },
        { left: { kind: 'field', field: 'open', offset: 1 }, op: 'lt', right: { kind: 'field', field: 'close', offset: 1 }, conj: 'and' },
      ],
    } }),
    toggleMath: (idx, side) => set((st) => { const k = idx + ':' + side; const m = { ...st.mathOpen }; m[k] = !m[k]; return { mathOpen: m }; }),
    setCondMult: (idx, side, v) => set((st) => {
      if (!st.screenDraft) return {};
      const conds = st.screenDraft.conds.slice(); const c = { ...conds[idx] }; c[side] = { ...c[side], mult: v }; conds[idx] = c;
      return { screenDraft: { ...st.screenDraft, conds } };
    }),
    setCondAdd: (idx, side, v) => set((st) => {
      if (!st.screenDraft) return {};
      const conds = st.screenDraft.conds.slice(); const c = { ...conds[idx] }; c[side] = { ...c[side], add: v }; conds[idx] = c;
      return { screenDraft: { ...st.screenDraft, conds } };
    }),
    togglePcf: () => set((st) => ({ pcfOpen: !st.pcfOpen, pcfError: '' })),
    onPcfText: (v) => set({ pcfText: v, pcfError: '' }),
    onParsePCF: () => {
      const st = get();
      const res = M.parsePCF(st.pcfText || '');
      if ('error' in res) { set({ pcfError: res.error }); return; }
      const inds = st.savedIndicators.slice();
      const ensure = (def: IndicatorDef) => {
        const sig = M.defSig(def);
        const found = inds.find((i) => M.defSig(i) === sig);
        if (found) return (found as { id: string }).id;
        const id = uid6('ind');
        const color = PALETTE[inds.length % PALETTE.length];
        inds.push({ id, name: M.autoIndName(def), color, ...def } as IndicatorDef);
        return id;
      };
      const toDraftOp = (op: { kind: string; value?: unknown; field?: string; offset?: number; mult?: unknown; add?: unknown; def?: IndicatorDef }): OperandDraft => {
        if (op.kind === 'const') return { kind: 'const', value: op.value as number };
        if (op.kind === 'field') return { kind: 'field', field: op.field, offset: op.offset || 0, mult: op.mult as number, add: op.add as number };
        return { kind: 'ind', id: ensure(op.def as IndicatorDef), offset: op.offset || 0, mult: op.mult as number, add: op.add as number };
      };
      const ruleConds = (res.rule as unknown as { conds: { left: never; op: string; right: never; conj: 'and' | 'or' }[] }).conds;
      const conds = ruleConds.map((c) => ({ left: toDraftOp(c.left), op: c.op, right: toDraftOp(c.right), conj: c.conj }));
      if (inds.length !== st.savedIndicators.length) save(STORE, inds);
      set({ savedIndicators: inds, screenDraft: { name: '', nameTouched: false, conds }, pcfOpen: false, pcfError: '', mathOpen: {} });
    },
    onScreenName: (v) => set((st) => st.screenDraft ? ({ screenDraft: { ...st.screenDraft, name: v, nameTouched: true } }) : {}),
    saveScreen: () => {
      const st = get();
      if (!st.screenDraft) return;
      const d = st.screenDraft;
      const rule = st.screenRule(d);
      if (!rule) return;
      const name = (d.nameTouched && d.name.trim()) ? d.name.trim() : M.groupLabel(rule as never);
      const editId = st.editingScreenId;
      if (editId) {
        const list = st.savedScreens.map((s) => (s.id === editId ? { ...s, name, rule } : s));
        save(SCREENS, list);
        set({
          savedScreens: list, screenBuilderOpen: false, editingScreenId: null,
          customRules: st.customRules.map((r) => ((r as { screenId?: string }).screenId === editId ? ({ ...rule, name, screenId: editId } as Rule) : r)),
        });
        return;
      }
      const id = uid('scr');
      const screen: Screen = { id, name, rule };
      const list = [...st.savedScreens, screen];
      save(SCREENS, list);
      set({
        savedScreens: list, screenBuilderOpen: false,
        customRules: [...st.customRules.filter((r) => (r as { screenId?: string }).screenId !== id), { ...rule, name, screenId: id } as Rule],
      });
    },
    applyScreen: (scr) => set((st) => {
      const exists = st.customRules.some((r) => (r as { screenId?: string }).screenId === scr.id);
      if (exists) return { customRules: st.customRules.filter((r) => (r as { screenId?: string }).screenId !== scr.id) };
      return { customRules: [...st.customRules, { ...scr.rule, name: scr.name, screenId: scr.id } as Rule] };
    }),
    deleteScreen: (id) => {
      const st = get();
      const list = st.savedScreens.filter((s) => s.id !== id);
      save(SCREENS, list);
      set({ savedScreens: list, customRules: st.customRules.filter((r) => (r as { screenId?: string }).screenId !== id) });
    },

    // ---- rule builder ----
    onRuleLeft: (v) => set((st) => ({ rule: { ...st.rule, leftId: v } })),
    onRuleOp: (v) => set((st) => ({ rule: { ...st.rule, op: v } })),
    onRuleRhsType: (v) => set((st) => ({ rule: { ...st.rule, rhsType: v as RhsType } })),
    onRuleValue: (v) => set((st) => ({ rule: { ...st.rule, value: v } })),
    onRuleRight: (v) => set((st) => ({ rule: { ...st.rule, rightId: v } })),
    onRuleMin: (v) => set((st) => ({ rule: { ...st.rule, min: v } })),
    onRuleMax: (v) => set((st) => ({ rule: { ...st.rule, max: v } })),
    addRule: () => {
      const st = get();
      const r = st.rule, inds = st.savedIndicators;
      const left = inds.find((i) => (i as { id: string }).id === r.leftId);
      if (!left) return;
      const leftDef = { ...left };
      let rule: Rule;
      if (r.op === 'between') rule = { kind: 'ind', left: leftDef, op: 'between', min: Number(r.min) || 0, max: Number(r.max) || 0 } as Rule;
      else if (r.op === 'rising' || r.op === 'falling') rule = { kind: 'ind', left: leftDef, op: r.op } as Rule;
      else {
        let rhs;
        if (r.rhsType === 'price') rhs = { type: 'price' };
        else if (r.rhsType === 'ind') {
          const right = inds.find((i) => (i as { id: string }).id === r.rightId) || ((inds[0] && (inds[0] as { id: string }).id !== r.leftId) ? inds[0] : inds[1]);
          if (!right) return;
          rhs = { type: 'ind', def: { ...right } };
        } else rhs = { type: 'const', value: Number(r.value) || 0 };
        rule = { kind: 'ind', left: leftDef, op: r.op, rhs } as Rule;
      }
      set({ customRules: [...st.customRules, rule] });
    },
    addFlag: (field) => set((st) => ({ customRules: [...st.customRules, { kind: 'flag', field } as Rule] })),

    // ---- patterns ----
    onPatternType: (v) => {
      const meta = (M.PATTERNS as Record<string, { count?: boolean; n?: number }>)[v];
      set({ patternDraft: { pat: v, n: meta && meta.count ? (meta.n as number) : 0 } });
    },
    onPatternN: (v) => set((st) => ({ patternDraft: { ...st.patternDraft, n: v } })),
    addPattern: () => {
      const st = get();
      const d = st.patternDraft;
      const meta = (M.PATTERNS as Record<string, { count?: boolean; n?: number; min?: number; max?: number }>)[d.pat];
      let n = parseInt(String(d.n), 10);
      if (meta && meta.count) { if (isNaN(n)) n = meta.n as number; n = Math.max(meta.min as number, Math.min(meta.max as number, n)); }
      const rule = { kind: 'pattern', pat: d.pat, n } as Rule & { name?: string };
      rule.name = M.patternLabel(rule as never);
      set({ customRules: [...st.customRules, rule] });
    },

    // ---- presets ----
    setPreset: (id) => { set({ activePreset: id }); saveView(); },
    clearAll: () => { set({ activePreset: 'all', customRules: [] }); saveView(); },
    removeRule: (i) => set((st) => ({ customRules: st.customRules.filter((_, idx) => idx !== i), editChip: st.editChip === i ? null : st.editChip })),
    editPreset: (id) => {
      const p = get().presetById(id);
      set({ editingPreset: id, presetName: p.name || '', presetDesc: p.desc || '', activePreset: 'all', customRules: p.rules.map((r) => ({ ...r })), editChip: null });
      saveView();
    },
    newPreset: () => {
      const eff = get().effectiveRules().map((r) => { const { screenId, ...rest } = r as { screenId?: string }; void screenId; return rest as Rule; });
      set({ editingPreset: '__new__', presetName: '', presetDesc: '', activePreset: 'all', customRules: eff, editChip: null });
      saveView();
    },
    onPresetName: (v) => set({ presetName: v }),
    onPresetDesc: (v) => set({ presetDesc: v }),
    savePreset: () => {
      const st = get();
      const name = (st.presetName || '').trim() || 'My preset';
      const desc = (st.presetDesc || '').trim();
      const rules = st.customRules.map((r) => { const { screenId, ...rest } = r as { screenId?: string }; void screenId; return rest as Rule; });
      const ps: PresetStore = { custom: [...(st.presetStore.custom || [])], overrides: { ...st.presetStore.overrides }, hidden: [...(st.presetStore.hidden || [])] };
      let savedId = st.editingPreset as string;
      if (savedId === '__new__') {
        savedId = uid('up');
        ps.custom.push({ id: savedId, name, desc, rules } as Preset);
      } else if (M.PRESETS.some((p) => p.id === savedId)) {
        ps.overrides[savedId] = { name, desc, rules };
      } else {
        ps.custom = ps.custom.map((p) => (p.id === savedId ? { ...p, name, desc, rules } : p));
      }
      savePresetStore(ps);
      set({ presetStore: ps, editingPreset: null, activePreset: savedId, customRules: [], editChip: null });
      saveView();
    },
    cancelPresetEdit: () => {
      const st = get();
      const id = st.editingPreset;
      const exists = !!id && id !== '__new__' && st.presets().some((p) => p.id === id);
      set({ editingPreset: null, customRules: [], editChip: null, activePreset: exists ? (id as string) : 'all' });
      saveView();
    },
    resetPreset: () => {
      const st = get();
      const id = st.editingPreset as string;
      const ps: PresetStore = { ...st.presetStore, overrides: { ...st.presetStore.overrides } };
      delete ps.overrides[id];
      savePresetStore(ps);
      const def = presetByIdFrom(ps, id);
      set({ presetStore: ps, presetName: def.name || '', presetDesc: def.desc || '', customRules: def.rules.map((r) => ({ ...r })), editChip: null });
    },
    deletePreset: () => {
      const st = get();
      const id = st.editingPreset as string;
      const ps: PresetStore = { custom: [...(st.presetStore.custom || [])], overrides: { ...st.presetStore.overrides }, hidden: [...(st.presetStore.hidden || [])] };
      if (M.PRESETS.some((p) => p.id === id)) { delete ps.overrides[id]; if (!ps.hidden.includes(id)) ps.hidden.push(id); }
      else ps.custom = ps.custom.filter((p) => p.id !== id);
      savePresetStore(ps);
      set({ presetStore: ps, editingPreset: null, customRules: [], editChip: null, activePreset: 'all' });
      saveView();
    },

    // ---- chip editing ----
    openChipEdit: (i) => set((st) => ({ editChip: st.editChip === i ? null : i })),
    closeChipEdit: () => set({ editChip: null }),
    patchRule: (i, patch, relabel) => set((st) => {
      const customRules = st.customRules.slice();
      const r = { ...customRules[i], ...patch } as Rule & { name?: string };
      if (relabel) r.name = relabel(r);
      customRules[i] = r;
      return { customRules };
    }),
    onChipNum: (i, key, v) => get().patchRule(i, { [key]: v } as Partial<Rule>),
    onChipPatternN: (i, v) => get().patchRule(i, { n: v } as unknown as Partial<Rule>, (r) => M.patternLabel({ ...r, n: parseInt(v, 10) || (r as { n: number }).n } as never)),
    onChipRank: (i, key, v) => get().patchRule(i, { [key]: v } as Partial<Rule>, (r) => M.rankLabel({ ...r, [key]: v } as never)),
    onChipIndConst: (i, v) => set((st) => {
      const cr = st.customRules.slice();
      const rr = cr[i] as { rhs?: object };
      cr[i] = { ...cr[i], rhs: { ...rr.rhs, value: v } } as Rule;
      return { customRules: cr };
    }),
    toggleRuleConj: (i) => set((st) => {
      const customRules = st.customRules.slice();
      if (customRules[i]) customRules[i] = { ...customRules[i], conj: (customRules[i] as { conj?: string }).conj === 'or' ? 'and' : 'or' } as Rule;
      return { customRules };
    }),

    // ---- view / misc ----
    onSearch: (v) => set({ search: v }),
    onSector: (v) => { set({ sectorFilter: v }); saveView(); },
    setSort: (k) => { set((st) => ({ sortKey: k, sortDir: st.sortKey === k && st.sortDir === 'desc' ? 'asc' : 'desc' })); saveView(); },
    selectStock: (t) => set({ selected: t }),
    closeDetail: () => set({ selected: null }),
    setLayout: (l) => { set({ layout: l }); saveView(); },
    togglePanel: (k) => set((st) => ({ panels: { ...st.panels, [k]: !st.panels[k] } })),
    toggleRuleSection: () => set((st) => ({ ruleOpen: !st.ruleOpen })),
    togglePatternSection: () => set((st) => ({ patternOpen: !st.patternOpen })),
    togglePin: (t) => set((st) => {
      const pinned = st.pinned.includes(t) ? st.pinned.filter((x) => x !== t) : [...st.pinned, t];
      save(PINS, pinned);
      return { pinned };
    }),
    setDensity: (d) => { set({ density: d }); saveView(); },

    // ---- ranking ----
    toggleRankSection: () => set((st) => ({ rankOpen: !st.rankOpen })),
    onRankField: (v) => set((st) => ({ rankDraft: { ...st.rankDraft, field: v } })),
    onRankScope: (v) => set((st) => ({ rankDraft: { ...st.rankDraft, scope: v } })),
    onRankDir: (v) => set((st) => ({ rankDraft: { ...st.rankDraft, dir: v } })),
    onRankPct: (v) => set((st) => ({ rankDraft: { ...st.rankDraft, pct: v } })),
    addRank: () => {
      const st = get();
      const d = st.rankDraft;
      const rule = { kind: 'rank', field: d.field, scope: d.scope, dir: d.dir, pct: Math.max(1, Math.min(99, parseInt(String(d.pct), 10) || 10)) } as Rule & { name?: string };
      rule.name = M.rankLabel(rule as never);
      set({ customRules: [...st.customRules, rule] });
    },

    // ---- compare ----
    toggleCompare: (t) => set((st) => {
      if (st.compareSel.includes(t)) return { compareSel: st.compareSel.filter((x) => x !== t) };
      if (st.compareSel.length >= 4) return {};
      return { compareSel: [...st.compareSel, t] };
    }),
    openCompare: () => set({ compareOpen: true }),
    closeCompare: () => set({ compareOpen: false }),
    clearCompare: () => set({ compareSel: [], compareOpen: false }),

    // ---- backtest / heatmap / alerts / refresh ----
    openBacktest: () => {
      const st = get();
      const preset = st.presetById(st.activePreset);
      const eff = [...preset.rules, ...st.customRules.filter((r) => (r as { kind: string }).kind !== 'rank')];
      const res = M.backtestRules(st.universe, eff);
      set({ backtestOpen: true, backtestResult: res });
    },
    closeBacktest: () => set({ backtestOpen: false }),
    toggleHeatmap: () => set((st) => ({ heatmapOpen: !st.heatmapOpen })),
    toggleAlert: (id) => set((st) => {
      const alertScreens = { ...st.alertScreens, [id]: !st.alertScreens[id] };
      save(ALERTS, alertScreens);
      return { alertScreens };
    }),
    refreshData: () => {
      const st = get();
      const screenTickers = (universe: Stock[]) => {
        const preset = st.presetById(st.activePreset);
        const rankRules = st.customRules.filter((r) => (r as { kind: string }).kind === 'rank') as RankRule[];
        const others = st.customRules.filter((r) => (r as { kind: string }).kind !== 'rank');
        const evalList = [...preset.rules, ...others];
        let list = universe.filter((s) => M.evalGroupedRules(s, evalList));
        for (const rr of rankRules) { const pass = M.rankPassSet(universe, rr); list = list.filter((s) => pass.has(s.ticker)); }
        return list.map((s) => s.ticker);
      };
      const prev = new Set(screenTickers(st.universe));
      const seed = st.seed + 1;
      const universe = M.buildUniverse(syntheticProvider(seed).getUniverse());
      set({ universe, seed, selected: null, compareSel: [], compareOpen: false });
      const now = new Set(screenTickers(universe));
      const entered = [...now].filter((t) => !prev.has(t));
      const exited = [...prev].filter((t) => !now.has(t));
      const alerts: { name: string; count: number }[] = [];
      for (const scr of get().savedScreens) {
        if (!get().alertScreens[scr.id]) continue;
        const cnt = universe.filter((s) => M.evalRuleAt(s, scr.rule, s.nLast)).length;
        if (cnt > 0) alerts.push({ name: scr.name, count: cnt });
      }
      set({ diff: { entered, exited, alerts } });
    },
    dismissDiff: () => set({ diff: null }),
  };
});
