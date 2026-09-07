// strategy/steps.ts — the step-type registry.
//
// One entry per step type: label, kind, holdability, defaults, a param schema
// (drives both the parser's coercion and the builder's generated controls), a
// one-line description for stories, and `compile`, which binds the step's
// parameters to a subject's series and returns the bar predicates the engine
// calls (`fires`, `holds`, `extends`, `price`).

import {
  crossDown,
  crossUp,
  fullFanUp,
  isBunnLongReversal,
  isLongReversal,
  isMaBounce,
  macdFav,
  slopeUp,
  slowFanUp,
  statusAt,
  type MacdSeries,
} from './primitives.ts';
import type {
  EmaCrossParams,
  EmaPeriod,
  EmaSlopeParams,
  EmaTagParams,
  FanOnsetParams,
  FanUpParams,
  MacdFavorableParams,
  PriceVsEmaParams,
  PullbackRunParams,
  PullbackSwingParams,
  ReversalCandleParams,
  Step,
  StepKind,
  StepParams,
  StepType,
  StrategyDef,
} from './types.ts';

export interface Series {
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  e18: number[];
  e50: number[];
  e100: number[];
  e200: number[];
  macd: MacdSeries;
  atr: number[];
}

export function emaOf(s: Series, p: EmaPeriod): number[] {
  if (p === 18) return s.e18;
  if (p === 50) return s.e50;
  if (p === 100) return s.e100;
  return s.e200;
}

export type ParamOption = { value: string | number | null; label: string };
export type ParamField =
  | { key: string; label: string; kind: 'enum'; options: ParamOption[] }
  | { key: string; label: string; kind: 'number'; min: number; max: number; integer?: boolean }
  | { key: string; label: string; kind: 'boolean' }
  | { key: string; label: string; kind: 'ema_set'; options: { value: number; label: string }[] };

/** Bar predicates the engine drives, bound to one subject's series. */
export interface Behaviour {
  /** True when the step fires on bar i. `prevBar` is the previous step's mark bar (-1 = none). */
  fires(i: number, prevBar: number): boolean;
  /** Invariant check while later steps wait (holdable types only). */
  holds?(i: number): boolean;
  /** Pullback run only: bar i extends the run while the next step waits. */
  extends?(i: number): boolean;
  /** Where to draw the mark. */
  price(i: number): number;
}

export interface StepTypeDef<P extends StepParams> {
  type: P['type'];
  label: string;
  holdable: boolean;
  /** The mark pins a specific bar (a candle, a swing high, a cross) rather than a condition that merely became true. */
  anchored: boolean;
  kindOf(p: P): StepKind;
  defaults(raw?: Record<string, unknown>): P;
  schema(p: P): ParamField[];
  describe(p: P): string;
  markLabel(p: P): string;
  compile(p: P, s: Series): Behaviour;
}

function def<P extends StepParams>(d: StepTypeDef<P>): StepTypeDef<P> {
  return d;
}

const EMA_OPTIONS: ParamOption[] = [18, 50, 100, 200].map((v) => ({ value: v, label: `${v}-EMA` }));

function fanFn(mode: 'full' | 'slow', s: Series): (i: number) => boolean {
  return mode === 'full'
    ? (i) => fullFanUp(s.e18, s.e50, s.e100, s.e200, i)
    : (i) => slowFanUp(s.e50, s.e100, s.e200, i);
}

const fanUp = def<FanUpParams>({
  type: 'fan_up',
  label: 'EMA fan up',
  holdable: true,
  anchored: false,
  kindOf: () => 'instant',
  defaults: () => ({ type: 'fan_up', mode: 'full' }),
  schema: () => [
    { key: 'mode', label: 'Stack', kind: 'enum', options: [
      { value: 'full', label: '18 > 50 > 100 > 200' },
      { value: 'slow', label: '50 > 100 > 200' },
    ] },
  ],
  describe: (p) => (p.mode === 'full' ? '18 > 50 > 100 > 200 stacked' : '50 > 100 > 200 stacked'),
  markLabel: () => 'fan',
  compile: (p, s) => {
    const f = fanFn(p.mode, s);
    return { fires: f, holds: f, price: (i) => s.e50[i] };
  },
});

const fanOnset = def<FanOnsetParams>({
  type: 'fan_onset',
  label: 'Fan onset',
  holdable: false,
  anchored: true,
  kindOf: () => 'candle',
  defaults: () => ({ type: 'fan_onset', entry: 'match' }),
  schema: () => [
    { key: 'entry', label: 'Status turns', kind: 'enum', options: [
      { value: 'match', label: 'stacked (18 > 50 > 100 > 200)' },
      { value: 'near', label: 'near (approaching the stack)' },
    ] },
  ],
  describe: (p) => (p.entry === 'match'
    ? 'first bar the full 18 > 50 > 100 > 200 stack appeared'
    : 'first bar the fan turned near (approaching the stack)'),
  markLabel: () => 'fan on',
  compile: (p, s) => ({
    fires: (i) => i >= 1
      && statusAt(s.e18, s.e50, s.e100, s.e200, i) === p.entry
      && statusAt(s.e18, s.e50, s.e100, s.e200, i - 1) !== p.entry,
    price: (i) => s.c[i],
  }),
});

const emaCross = def<EmaCrossParams>({
  type: 'ema_cross',
  label: 'EMA cross',
  holdable: true,
  anchored: true,
  // A cross is an indicator event on a bar, not a candle shape: it does not
  // consume the bar, so a reversal candle (or a tag) can fire on the same bar.
  kindOf: () => 'instant',
  defaults: () => ({ type: 'ema_cross', fast: 18, slow: 50, dir: 'up', require: 'slow_fan' }),
  schema: () => [
    { key: 'fast', label: 'Fast', kind: 'enum', options: EMA_OPTIONS },
    { key: 'slow', label: 'Slow', kind: 'enum', options: EMA_OPTIONS },
    { key: 'dir', label: 'Direction', kind: 'enum', options: [{ value: 'up', label: 'crosses up' }, { value: 'down', label: 'crosses down' }] },
    { key: 'require', label: 'While', kind: 'enum', options: [
      { value: 'none', label: 'no fan required' },
      { value: 'slow_fan', label: '50 > 100 > 200' },
      { value: 'full_fan', label: '18 > 50 > 100 > 200' },
    ] },
  ],
  describe: (p) => {
    const req = p.require === 'slow_fan' ? ' while 50 > 100 > 200 held' : p.require === 'full_fan' ? ' with 18 > 50 > 100 > 200 stacked' : '';
    return p.dir === 'up'
      ? `${p.fast} crossed up through ${p.slow}${req}`
      : `${p.fast} adversely crossed below ${p.slow}${req}`;
  },
  markLabel: (p) => (p.dir === 'up' ? 'cross ↑' : 'cross ↓'),
  compile: (p, s) => {
    const f = emaOf(s, p.fast);
    const sl = emaOf(s, p.slow);
    const req = p.require === 'slow_fan' ? fanFn('slow', s) : p.require === 'full_fan' ? fanFn('full', s) : () => true;
    const cross = p.dir === 'up' ? crossUp : crossDown;
    return {
      fires: (i) => cross(f, sl, i) && req(i),
      // Lagged one bar so the opposite cross can fire before the hold breaks.
      holds: (i) => i >= 1 && (p.dir === 'up' ? f[i - 1] > sl[i - 1] : f[i - 1] < sl[i - 1]),
      price: (i) => sl[i],
    };
  },
});

function runCond(p: PullbackRunParams, s: Series, k: number): boolean {
  if (k < 1) return false;
  if (p.lowerHighs && !(s.h[k] < s.h[k - 1])) return false;
  if (p.lowerLows && !(s.l[k] < s.l[k - 1])) return false;
  return true;
}

function runBelow(p: PullbackRunParams, s: Series, i: number): boolean {
  if (p.belowEma == null) return true;
  const e = emaOf(s, p.belowEma)[i];
  const v = p.belowField === 'low' ? s.l[i] : s.c[i];
  return v < e;
}

const pullback = def<PullbackRunParams | PullbackSwingParams>({
  type: 'pullback',
  label: 'Pullback',
  holdable: false,
  anchored: true,
  kindOf: (p) => (p.mode === 'swing' ? 'tracker' : 'candle'),
  defaults: (raw) => (raw?.mode === 'swing'
    ? { type: 'pullback', mode: 'swing', maxLowerLows: 2, rearmOnNewHigh: true }
    : { type: 'pullback', mode: 'run', minBars: 3, lowerHighs: true, lowerLows: true, belowEma: 18, belowField: 'low', nextBarOnly: true }),
  schema: (p) => {
    const mode: ParamField = { key: 'mode', label: 'Mode', kind: 'enum', options: [
      { value: 'run', label: 'run of lower bars' },
      { value: 'swing', label: 'swing (track lower lows)' },
    ] };
    if (p.mode === 'swing') {
      return [
        mode,
        { key: 'maxLowerLows', label: 'Max lower lows', kind: 'number', min: 0, max: 2, integer: true },
        { key: 'rearmOnNewHigh', label: 'Re-arm after a new swing high', kind: 'boolean' },
      ];
    }
    return [
      mode,
      { key: 'minBars', label: 'Min bars', kind: 'number', min: 1, max: 20, integer: true },
      { key: 'lowerHighs', label: 'Lower highs', kind: 'boolean' },
      { key: 'lowerLows', label: 'Lower lows', kind: 'boolean' },
      { key: 'belowEma', label: 'Last bar below', kind: 'enum', options: [
        { value: 18, label: '18-EMA' }, { value: 50, label: '50-EMA' }, { value: 100, label: '100-EMA' }, { value: null, label: 'any level' },
      ] },
      { key: 'belowField', label: 'Below means', kind: 'enum', options: [{ value: 'low', label: 'the low' }, { value: 'close', label: 'the close' }] },
      { key: 'nextBarOnly', label: 'Next step on the very next bar', kind: 'boolean' },
    ];
  },
  describe: (p) => {
    if (p.mode === 'swing') {
      return `pullback off the swing high with at most ${p.maxLowerLows} lower low${p.maxLowerLows === 1 ? '' : 's'}${p.rearmOnNewHigh ? ', re-armed after a new high' : ''}`;
    }
    const shape = p.lowerHighs && p.lowerLows ? 'lower highs and lows' : p.lowerHighs ? 'lower highs' : p.lowerLows ? 'lower lows' : 'bars';
    const below = p.belowEma == null ? '' : ` ending with the ${p.belowField} under the ${p.belowEma}-EMA`;
    return `${p.minBars}+ bar pullback of ${shape}${below}`;
  },
  markLabel: (p) => (p.mode === 'swing' ? 'high' : 'pullback'),
  compile: (p, s) => {
    if (p.mode === 'swing') {
      return { fires: () => true, price: (i) => s.h[i] };
    }
    const n = s.c.length;
    const runLen = new Array<number>(n).fill(0);
    for (let k = 1; k < n; k++) runLen[k] = runCond(p, s, k) ? runLen[k - 1] + 1 : 0;
    return {
      fires: (i, prevBar) => Math.min(runLen[i], i - prevBar) >= p.minBars && runBelow(p, s, i),
      extends: (i) => runCond(p, s, i) && runBelow(p, s, i),
      price: (i) => s.l[i],
    };
  },
});

const priceVsEma = def<PriceVsEmaParams>({
  type: 'price_vs_ema',
  label: 'Price vs EMA',
  holdable: true,
  anchored: true,
  kindOf: () => 'candle',
  defaults: () => ({ type: 'price_vs_ema', ema: 18, field: 'high', dir: 'above' }),
  schema: () => [
    { key: 'field', label: 'Field', kind: 'enum', options: [{ value: 'high', label: 'high' }, { value: 'close', label: 'close' }, { value: 'low', label: 'low' }] },
    { key: 'dir', label: 'Is', kind: 'enum', options: [{ value: 'above', label: 'above' }, { value: 'below', label: 'below' }] },
    { key: 'ema', label: 'EMA', kind: 'enum', options: EMA_OPTIONS },
  ],
  describe: (p) => `${p.field} ${p.dir} the ${p.ema}-EMA`,
  markLabel: (p) => `${p.field} ${p.dir === 'above' ? '>' : '<'} ${p.ema}`,
  compile: (p, s) => {
    const e = emaOf(s, p.ema);
    const field = p.field === 'high' ? s.h : p.field === 'low' ? s.l : s.c;
    const f = (i: number) => (p.dir === 'above' ? field[i] > e[i] : field[i] < e[i]);
    return { fires: f, holds: f, price: (i) => field[i] };
  },
});

const emaTag = def<EmaTagParams>({
  type: 'ema_tag',
  label: 'EMA tag',
  holdable: false,
  anchored: true,
  kindOf: () => 'candle',
  defaults: () => ({ type: 'ema_tag', ema: 50, throughEma: null, confirm: 'none' }),
  schema: () => [
    { key: 'ema', label: 'Tags the', kind: 'enum', options: [{ value: 18, label: '18-EMA' }, { value: 50, label: '50-EMA' }] },
    { key: 'throughEma', label: 'Also trades through', kind: 'enum', options: [{ value: null, label: '—' }, { value: 18, label: 'the 18-EMA' }] },
    { key: 'confirm', label: 'Confirmation', kind: 'enum', options: [
      { value: 'none', label: 'close back above is enough' },
      { value: 'reversal_or_bounce', label: '2-bar reversal or rejection wick' },
    ] },
  ],
  describe: (p) => {
    const through = p.throughEma ? ` and traded up through the ${p.throughEma}` : '';
    const confirm = p.confirm === 'reversal_or_bounce' ? ' with a 2-bar reversal or rejection wick' : '';
    return `pullback tagged the ${p.ema}-EMA and closed back above it${through}${confirm}`;
  },
  markLabel: (p) => `tag ${p.ema}`,
  compile: (p, s) => {
    const e = emaOf(s, p.ema);
    return {
      fires: (i) => s.l[i] <= e[i] && s.c[i] >= e[i]
        && (p.throughEma == null || s.h[i] >= emaOf(s, p.throughEma)[i])
        && (p.confirm === 'none' || isLongReversal(s.o, s.h, s.c, i) || isMaBounce(s.o, s.h, s.l, s.c, e, i)),
      price: (i) => e[i],
    };
  },
});

const reversalCandle = def<ReversalCandleParams>({
  type: 'reversal_candle',
  label: 'Reversal candle on an EMA',
  holdable: false,
  anchored: true,
  kindOf: () => 'candle',
  defaults: () => ({ type: 'reversal_candle', emas: [50, 100, 200], style: 'bunn', refresh: false }),
  schema: () => [
    { key: 'emas', label: 'On any of', kind: 'ema_set', options: [{ value: 50, label: '50' }, { value: 100, label: '100' }, { value: 200, label: '200' }] },
    { key: 'style', label: 'Shape', kind: 'enum', options: [
      { value: 'bunn', label: 'Bunn reversal (body above, tail through it and the prior low)' },
      { value: 'ma_bounce', label: 'rejection wick (close back above, upper 40%)' },
    ] },
    { key: 'refresh', label: 'Latest reversal wins while waiting', kind: 'boolean' },
  ],
  describe: (p) => {
    const list = p.emas.length > 1 ? `${p.emas.slice(0, -1).join(', ')}, or ${p.emas[p.emas.length - 1]}` : String(p.emas[0] ?? '');
    return p.style === 'bunn' ? `Bunn reversal on the ${list}` : `rejection bounce off the ${list}`;
  },
  markLabel: () => 'reversal',
  compile: (p, s) => {
    const series = p.emas.map((e) => emaOf(s, e));
    return {
      fires: (i) => series.some((ma) => (p.style === 'bunn'
        ? isBunnLongReversal(s.o, s.l, s.c, ma, i)
        : isMaBounce(s.o, s.h, s.l, s.c, ma, i))),
      price: (i) => s.l[i],
    };
  },
});

const macdFavorable = def<MacdFavorableParams>({
  type: 'macd_favorable',
  label: '18–50 MACD favorable',
  holdable: false,
  anchored: false,
  kindOf: () => 'guard',
  defaults: () => ({ type: 'macd_favorable' }),
  schema: () => [],
  describe: () => '18–50 MACD favorable (line above signal, histogram ≥ 0)',
  markLabel: () => 'MACD',
  compile: (_p, s) => ({ fires: (i) => macdFav(s.macd, i), price: (i) => s.c[i] }),
});

const emaSlope = def<EmaSlopeParams>({
  type: 'ema_slope',
  label: 'EMA rising',
  holdable: true,
  anchored: false,
  kindOf: () => 'guard',
  defaults: () => ({ type: 'ema_slope', ema: 50, lookback: 5 }),
  schema: () => [
    { key: 'ema', label: 'EMA', kind: 'enum', options: EMA_OPTIONS },
    { key: 'lookback', label: 'Higher than N bars ago', kind: 'number', min: 1, max: 250, integer: true },
  ],
  describe: (p) => `${p.ema}-EMA rising over ${p.lookback} bars`,
  markLabel: (p) => `${p.ema} rising`,
  compile: (p, s) => {
    const e = emaOf(s, p.ema);
    const f = (i: number) => slopeUp(e, i, p.lookback);
    return { fires: f, holds: f, price: (i) => e[i] };
  },
});

export const STEP_TYPES = {
  fan_up: fanUp,
  fan_onset: fanOnset,
  ema_cross: emaCross,
  pullback,
  price_vs_ema: priceVsEma,
  ema_tag: emaTag,
  reversal_candle: reversalCandle,
  macd_favorable: macdFavorable,
  ema_slope: emaSlope,
};

/** Menu order for the builder. */
export const STEP_TYPE_IDS: StepType[] = [
  'fan_up', 'fan_onset', 'ema_cross', 'pullback', 'price_vs_ema', 'ema_tag', 'reversal_candle', 'macd_favorable', 'ema_slope',
];

export function isStepType(v: unknown): v is StepType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(STEP_TYPES, v);
}

export function stepTypeOf(type: StepType): StepTypeDef<StepParams> {
  return STEP_TYPES[type] as unknown as StepTypeDef<StepParams>;
}

export function stepKindOf(step: StepParams): StepKind {
  return stepTypeOf(step.type).kindOf(step);
}

export function isAnchored(type: StepType): boolean {
  return stepTypeOf(type).anchored;
}

export function isHoldable(type: StepType): boolean {
  return stepTypeOf(type).holdable;
}

export function stepLabel(step: StepParams): string {
  return stepTypeOf(step.type).markLabel(step);
}

export function describeStep(step: StepParams): string {
  return stepTypeOf(step.type).describe(step);
}

/** One-line story of the setup and the entry rule, for trade explanations and the example pane. */
export function describeStrategy(def: StrategyDef): string {
  const steps = def.steps.map((s) => describeStep(s) + (s.hold ? ' (held)' : ''));
  const entry = def.trade.entry.mode === 'buy_stop'
    ? `buy stop ${def.trade.entry.offset.toFixed(2)} above the trigger high`
    : 'buy the trigger close';
  return `${steps.join(' → ')}; ${entry}.`;
}

/** Fresh params for a step type (with the swing/run mode picked from `raw`). */
export function defaultParams(type: StepType, raw?: Record<string, unknown>): StepParams {
  return stepTypeOf(type).defaults(raw);
}

export function paramSchema(step: StepParams): ParamField[] {
  return stepTypeOf(step.type).schema(step);
}

/** Coerce raw params to a valid StepParams via the type's schema; invalid fields fall back to defaults. */
export function coerceParams(type: StepType, raw: Record<string, unknown>): StepParams {
  const base = defaultParams(type, raw) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const f of stepTypeOf(type).schema(base as unknown as StepParams)) {
    const v = raw[f.key];
    if (f.kind === 'enum') {
      if (f.options.some((o) => o.value === v)) out[f.key] = v;
    } else if (f.kind === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) {
        const clamped = Math.min(f.max, Math.max(f.min, v));
        out[f.key] = f.integer ? Math.round(clamped) : clamped;
      }
    } else if (f.kind === 'boolean') {
      if (typeof v === 'boolean') out[f.key] = v;
    } else if (f.kind === 'ema_set') {
      if (Array.isArray(v)) {
        const allowed = new Set(f.options.map((o) => o.value));
        const picked = [...new Set(v.filter((x): x is number => typeof x === 'number' && allowed.has(x)))].sort((a, b) => a - b);
        if (picked.length) out[f.key] = picked;
      }
    }
  }
  return out as unknown as StepParams;
}

export interface CompiledStep extends Behaviour {
  index: number;
  id: string;
  type: StepType;
  kind: StepKind;
  anchored: boolean;
  label: string;
  hold: boolean;
  maxWait: number | null;
  refresh: boolean;
  params: StepParams;
  tracker: PullbackSwingParams | null;
  extends(i: number): boolean;
  holds(i: number): boolean;
}

/** Bind a strategy's steps to one subject's series. */
export function compileSteps(steps: Step[], series: Series): CompiledStep[] {
  return steps.map((step, index) => {
    const t = stepTypeOf(step.type);
    const b = t.compile(step, series);
    const prev = index > 0 ? steps[index - 1] : null;
    const nextBarOnly = prev?.type === 'pullback' && prev.mode === 'run' && prev.nextBarOnly;
    const maxWait = nextBarOnly ? 1 : (typeof step.maxWait === 'number' ? step.maxWait : null);
    return {
      index,
      id: step.id,
      type: step.type,
      kind: t.kindOf(step),
      anchored: t.anchored,
      label: t.markLabel(step),
      hold: step.hold === true && t.holdable,
      maxWait,
      refresh: step.type === 'reversal_candle' && step.refresh === true,
      params: step,
      tracker: step.type === 'pullback' && step.mode === 'swing' ? step : null,
      fires: b.fires,
      holds: b.holds ?? (() => true),
      extends: b.extends ?? (() => false),
      price: b.price,
    };
  });
}

/** An ema_cross hold is released once a later ema_cross on the same pair fires the opposite way. */
export function releasesHold(later: CompiledStep, earlier: CompiledStep): boolean {
  const a = later.params;
  const b = earlier.params;
  return a.type === 'ema_cross' && b.type === 'ema_cross'
    && a.fast === b.fast && a.slow === b.slow && a.dir !== b.dir;
}
