// strategy/types.ts — the strategy data model.
//
// A StrategyDef is an ordered state machine of parameterized steps plus three
// editable trade rows (entry / stop / exit). The engine (engine.ts) walks the
// steps bar by bar; the example sketcher (example.ts, phase 3) draws them; the
// builder UI edits them. Step *kinds* are derived from the step type:
//
//   candle  — consumes a bar; at most one candle step fires per bar
//   instant — fires on the same bar as the previous step when true, else waits
//   guard   — must be true on the bar the preceding step fired; a failing guard
//             cancels that firing back to the nearest preceding candle step
//   tracker — fires instantly, then keeps state (swing high / lower lows)
//
// Only holdable types accept `hold`: a broken hold resets the machine to step 1.

export type EmaPeriod = 18 | 50 | 100 | 200;
export type StepKind = 'candle' | 'instant' | 'guard' | 'tracker';

export interface FanUpParams { type: 'fan_up'; mode: 'full' | 'slow' }
export interface FanOnsetParams { type: 'fan_onset'; entry: 'match' | 'near' }
export interface EmaCrossParams {
  type: 'ema_cross';
  fast: EmaPeriod;
  slow: EmaPeriod;
  dir: 'up' | 'down';
  require: 'none' | 'slow_fan' | 'full_fan';
}
export interface PullbackRunParams {
  type: 'pullback';
  mode: 'run';
  minBars: number;
  lowerHighs: boolean;
  lowerLows: boolean;
  belowEma: 18 | 50 | 100 | null;
  belowField: 'low' | 'close';
  /** The next step must fire on the very next bar (its maxWait becomes 1). */
  nextBarOnly: boolean;
}
export interface PullbackSwingParams {
  type: 'pullback';
  mode: 'swing';
  maxLowerLows: number;
  rearmOnNewHigh: boolean;
}
export interface PriceVsEmaParams {
  type: 'price_vs_ema';
  ema: EmaPeriod;
  field: 'high' | 'close' | 'low';
  dir: 'above' | 'below';
}
export interface EmaTagParams {
  type: 'ema_tag';
  ema: 18 | 50;
  throughEma: 18 | null;
  confirm: 'none' | 'reversal_or_bounce';
}
export interface ReversalCandleParams {
  type: 'reversal_candle';
  emas: (50 | 100 | 200)[];
  style: 'bunn' | 'ma_bounce';
  /** While the next step waits, a later reversal replaces the mark (latest wins). */
  refresh: boolean;
}
export interface MacdFavorableParams { type: 'macd_favorable' }
export interface EmaSlopeParams { type: 'ema_slope'; ema: EmaPeriod; lookback: number }

export type StepParams =
  | FanUpParams
  | FanOnsetParams
  | EmaCrossParams
  | PullbackRunParams
  | PullbackSwingParams
  | PriceVsEmaParams
  | EmaTagParams
  | ReversalCandleParams
  | MacdFavorableParams
  | EmaSlopeParams;

export type StepType = StepParams['type'];

export interface StepBase {
  id: string;
  /** Invariant: once fired, must keep holding or the machine resets. Holdable types only. */
  hold?: boolean;
  /** Bars the step may wait after the previous step fired. null = forever. */
  maxWait?: number | null;
}

export type Step = StepBase & StepParams;

export interface EntrySpec {
  /** buy_stop: fill at trigger high + offset from the next bar on. close: fill at the trigger close. */
  mode: 'buy_stop' | 'close';
  offset: number;
  /** Bars a pending buy stop may wait for its fill. null = until a hold breaks. */
  maxWait: number | null;
}

export interface StopSpec {
  /** setup_low: lowest low from the swing high (or first candle mark) to the fill; trigger_low: the trigger bar's low; mark_low: the low of the bar a step marked. */
  anchor: 'setup_low' | 'trigger_low' | 'mark_low';
  stepId?: string;
  /** Also cap the anchor at the 50-EMA on the fill bar. */
  underEma50: boolean;
  /** ATR(14) fraction padded under the anchor. */
  atrPad: number;
  /** Fixed price offset under the anchor. */
  offset: number;
}

export interface ExitSpec {
  /** Target as a multiple of 1R. Ignored when trailing. */
  targetR: number;
  /** Exit at 2.5R (course window floor). Ignored when trailing. */
  targetWindow: boolean;
  /** After breakeven, trail under this EMA. null = hard target instead. */
  trailEma: 18 | 50 | null;
  /** After entry, trail 2¢ under newly confirmed pivot lows. Overrides trailEma. */
  trailPivot: boolean;
  /** Move stop to entry once unrealized R reaches this. null = off. */
  breakevenAtR: number | null;
  maxHoldBars: number | null;
  /** Exit on an 18–50 MACD flip when not trailing. */
  macdExit: boolean;
  /** Flatten when this fan breaks. */
  fanExit: 'slow' | 'full';
}

export interface TradeSpec {
  entry: EntrySpec;
  stop: StopSpec;
  exit: ExitSpec;
}

export interface StrategyDef {
  id: string;
  name: string;
  description?: string;
  builtin?: boolean;
  steps: Step[];
  trade: TradeSpec;
}

/** One mark per fired step on an entry's chart. */
export interface StrategyMark {
  stepId: string;
  stepIndex: number;
  kind: StepKind;
  label: string;
  bar: number;
  price: number;
}
