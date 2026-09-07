// strategy/example.ts — the schematic example chart, generated from the steps.
//
// A sketch of synthetic bars is grown step by step: a long warm-up ramp builds a
// genuine stacked fan, then one sketcher per step type shapes candles relative to
// the *running* EMAs (the same incremental recurrence `indicators.ts` `ema` uses,
// seeded on the first close, so `ema()` over the closes reproduces them exactly).
// The real engine is then run over the sketch, and its marks, trade and reset
// trace drive the chart — so a strategy that cannot fire says which step failed
// instead of drawing a picture the engine would never take.
//
// Two passes: the first stops right after the fill so the entry, stop and target
// are known; the sketch is then truncated back to the fill bar and an exit run
// shaped by the ExitSpec is appended before the engine runs again.

import { classifyFanAtIndex } from '../fan.ts';
import type { FanBacktestConfig, FanBacktestSubject, FanEntryEvent } from '../fanBacktest.ts';
import { runStrategy, type StrategyRun } from './engine.ts';
import {
  BUNN_WINDOW_HI,
  BUNN_WINDOW_LO,
  crossDown,
  crossUp,
  fullFanUp,
  lastConfirmedPivotLow,
  macd1850,
  slowFanUp,
  statusAt,
} from './primitives.ts';
import { describeStep, describeStrategy, stepKindOf, stepLabel } from './steps.ts';
import type { EmaPeriod, ExitSpec, Step, StepKind, StrategyDef } from './types.ts';

export interface ExampleBar { o: number; h: number; l: number; c: number; v: number }

export interface ExamplePhase {
  id: string;
  label: string;
  from: number;
  to: number;
  fill: string;
}

export interface ExampleMark {
  bar: number;
  price: number;
  kind: StepKind | 'entry' | 'exit';
  label: string;
  /** Set for step marks; the entry / exit marks leave it null. */
  stepIndex: number | null;
  /** True when the step fired before the drawn window and its mark is pinned to the left edge. */
  clamped?: boolean;
}

export interface ExampleLevel { price: number; color: string; label: string; dash: number[] }
export interface ExampleBand { lo: number; hi: number; fill: string; label: string }

/** One row per step in the right-hand pane: ✓ with the bar it fired on, or ✗ with the reason. */
export interface ExampleCheck {
  stepIndex: number;
  label: string;
  detail: string;
  ok: boolean;
  bar: number | null;
  reason: string | null;
}

export interface ExampleFailure {
  stepIndex: number;
  label: string;
  detail: string;
  message: string;
}

export interface StrategyExampleModel {
  bars: ExampleBar[];
  ema18: number[];
  ema50: number[];
  ema100: number[];
  ema200: number[];
  macd: { line: number[]; signal: number[]; hist: number[] };
  showMacd: boolean;
  phases: ExamplePhase[];
  marks: ExampleMark[];
  levels: ExampleLevel[];
  bands: ExampleBand[];
  checks: ExampleCheck[];
  /** Null when the engine took a trade on the sketch; otherwise the first step that never fired. */
  failure: ExampleFailure | null;
  title: string;
  caption: string;
  notes: string[];
}

// ---------------------------------------------------------------- the sketch

interface SketchEmas { e18: number; e50: number; e100: number; e200: number }

interface Sketch {
  o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
  e18: number[]; e50: number[]; e100: number[]; e200: number[];
}

interface BarShape { o: number; h: number; l: number }

const K18 = 2 / 19;
const K50 = 2 / 51;
const K100 = 2 / 101;
const K200 = 2 / 201;

/** Bars of warm-up before the first step; the engine only scans from bar 200 (210 for a `near` onset). */
const WARM_BARS = 236;
const WARM_DRIFT = 0.0015;

function newSketch(): Sketch {
  return { o: [], h: [], l: [], c: [], v: [], e18: [], e50: [], e100: [], e200: [] };
}

/** Index of the last bar. */
function at(sk: Sketch): number {
  return sk.c.length - 1;
}

function px(sk: Sketch): number {
  return sk.c[at(sk)] ?? 0;
}

/** The EMA values bar `close` would produce if it were pushed now. */
function emaAfter(sk: Sketch, close: number): SketchEmas {
  const i = at(sk);
  if (i < 0) return { e18: close, e50: close, e100: close, e200: close };
  return {
    e18: close * K18 + sk.e18[i] * (1 - K18),
    e50: close * K50 + sk.e50[i] * (1 - K50),
    e100: close * K100 + sk.e100[i] * (1 - K100),
    e200: close * K200 + sk.e200[i] * (1 - K200),
  };
}

/** Solve for a close expressed in terms of the EMAs it produces (converges in a few passes). */
function closeFor(sk: Sketch, fn: (e: SketchEmas) => number): number {
  let close = px(sk) || 1;
  for (let k = 0; k < 4; k++) close = fn(emaAfter(sk, close));
  return close;
}

function defaultShape(prev: number, close: number): BarShape {
  const up = close >= prev;
  const o = prev + (close - prev) * 0.35;
  const span = Math.abs(close) * 0.003;
  return {
    o,
    h: Math.max(o, close) + span * (up ? 1 : 0.55),
    l: Math.min(o, close) - span * (up ? 0.55 : 1),
  };
}

function push(
  sk: Sketch,
  close: number,
  shape?: (e: SketchEmas, close: number, prev: number) => Partial<BarShape>,
  vol = 1,
): void {
  const e = emaAfter(sk, close);
  const prev = sk.c.length ? px(sk) : close;
  const base = defaultShape(prev, close);
  const s = shape ? { ...base, ...shape(e, close, prev) } : base;
  const h = Math.max(s.h, s.o, close);
  const l = Math.min(s.l, s.o, close);
  sk.v.push(Math.round((820_000 + (sk.c.length % 5) * 60_000) * vol));
  sk.o.push(s.o); sk.h.push(h); sk.l.push(l); sk.c.push(close);
  sk.e18.push(e.e18); sk.e50.push(e.e50); sk.e100.push(e.e100); sk.e200.push(e.e200);
}

function drift(sk: Sketch, pct: number, bars: number, vol = 1): void {
  for (let k = 0; k < bars; k++) push(sk, px(sk) * (1 + pct), undefined, vol);
}

/** Push bars at `pct` until `ok()` holds on the last bar. Returns whether it got there. */
function until(sk: Sketch, pct: number, ok: () => boolean, cap: number): boolean {
  for (let k = 0; k < cap; k++) {
    if (ok()) return true;
    push(sk, px(sk) * (1 + pct));
  }
  return ok();
}

function truncate(sk: Sketch, n: number): void {
  for (const arr of [sk.o, sk.h, sk.l, sk.c, sk.v, sk.e18, sk.e50, sk.e100, sk.e200]) arr.length = n;
}

function emaSeries(sk: Sketch, p: EmaPeriod): number[] {
  return p === 18 ? sk.e18 : p === 50 ? sk.e50 : p === 100 ? sk.e100 : sk.e200;
}

function emaValue(e: SketchEmas, p: EmaPeriod): number {
  return p === 18 ? e.e18 : p === 50 ? e.e50 : p === 100 ? e.e100 : e.e200;
}

function warmUp(sk: Sketch): void {
  let price = 40;
  push(sk, price);
  for (let k = 1; k < WARM_BARS; k++) {
    price *= 1 + WARM_DRIFT + 0.0009 * Math.sin(k / 3.3);
    push(sk, price);
  }
}

// ------------------------------------------------------------- the sketchers

/** Grow the sketch so that `step` can fire on (or just after) the last bar drawn. */
function sketchStep(sk: Sketch, step: Step): void {
  switch (step.type) {
    case 'fan_up': {
      const ok = () => (step.mode === 'full'
        ? fullFanUp(sk.e18, sk.e50, sk.e100, sk.e200, at(sk))
        : slowFanUp(sk.e50, sk.e100, sk.e200, at(sk)));
      until(sk, 0.007, ok, 60);
      return;
    }
    case 'fan_onset': {
      const status = () => statusAt(sk.e18, sk.e50, sk.e100, sk.e200, at(sk));
      if (step.entry === 'near') {
        // Leave the fan far enough behind that the slow climb back spends more than
        // FAN_ENTER_LOOKBACK bars improving — "near" means entering, not exiting.
        const worst = () => classifyFanAtIndex(sk.e18, sk.e50, sk.e100, sk.e200, at(sk)).worstGap;
        until(sk, -0.008, () => worst() <= -0.02, 40);
        until(sk, 0.0012, () => status() === 'near', 80);
        return;
      }
      until(sk, -0.007, () => status() !== 'match', 30);
      drift(sk, -0.007, 3);
      until(sk, 0.009, () => status() === 'match', 30);
      return;
    }
    case 'ema_cross': {
      const fast = emaSeries(sk, step.fast);
      const slow = emaSeries(sk, step.slow);
      const req = step.require === 'slow_fan'
        ? () => slowFanUp(sk.e50, sk.e100, sk.e200, at(sk))
        : step.require === 'full_fan'
          ? () => fullFanUp(sk.e18, sk.e50, sk.e100, sk.e200, at(sk))
          : () => true;
      if (step.dir === 'up') {
        until(sk, -0.006, () => fast[at(sk)] < slow[at(sk)], 30);
        until(sk, 0.008, () => crossUp(fast, slow, at(sk)) && req(), 40);
      } else {
        until(sk, 0.007, () => fast[at(sk)] > slow[at(sk)], 15);
        until(sk, -0.006, () => crossDown(fast, slow, at(sk)) && req(), 30);
      }
      return;
    }
    case 'pullback': {
      if (step.mode === 'swing') {
        // The tracker fires on the previous step's bar; these bars are the impulse
        // it follows, each one a new swing high.
        drift(sk, 0.009, 5, 1.35);
        return;
      }
      sketchPullbackRun(sk, step.minBars, step.belowEma, step.belowField);
      return;
    }
    case 'price_vs_ema': {
      const e = step.ema;
      const above = step.dir === 'above';
      const close = closeFor(sk, (em) => emaValue(em, e) * (above ? 1.006 : 0.994));
      push(sk, close, (em) => {
        const ev = emaValue(em, e);
        const base = defaultShape(px(sk), close);
        return above
          ? { h: Math.max(base.h, ev * 1.008), l: Math.max(Math.min(base.l, close * 0.997), ev * 1.001) }
          : { l: Math.min(base.l, ev * 0.992), h: Math.min(Math.max(base.h, close * 1.003), ev * 0.999) };
      }, 1.5);
      return;
    }
    case 'ema_tag': {
      sketchTag(sk, step.ema, step.throughEma);
      return;
    }
    case 'reversal_candle': {
      sketchReversal(sk, step.emas);
      return;
    }
    default:
      // Guards (macd_favorable, ema_slope) draw nothing: they are checked on the
      // bar the preceding step fired.
      return;
  }
}

function sketchPullbackRun(
  sk: Sketch,
  minBars: number,
  belowEma: 18 | 50 | 100 | null,
  belowField: 'low' | 'close',
): void {
  const bars = Math.max(1, Math.min(minBars, 12));
  const start = px(sk);
  const floor = belowEma == null ? start * 0.965 : emaSeries(sk, belowEma)[at(sk)] * 0.995;
  for (let k = 0; k < bars; k++) {
    const t = (k + 1) / bars;
    const last = k === bars - 1;
    const prevHigh = sk.h[at(sk)];
    const prevLow = sk.l[at(sk)];
    const close = last && belowEma != null
      ? closeFor(sk, (em) => emaValue(em, belowEma) * (belowField === 'close' ? 0.996 : 1.004))
      : start + (floor - start) * t;
    push(sk, close, (em, c, prev) => {
      const level = belowEma == null ? null : emaValue(em, belowEma);
      const base = defaultShape(prev, c);
      const o = Math.min(c * 1.004, prevHigh * 0.996);
      const low = last && level != null && belowField === 'low'
        ? Math.min(base.l, level * 0.994)
        : base.l;
      return { o, h: Math.max(Math.min(base.h, prevHigh * 0.998), o, c), l: Math.min(low, prevLow * 0.997) };
    }, 0.8);
  }
}

/** A red approach bar, then a bar that wicks through the EMA and closes back above it. */
function sketchTag(sk: Sketch, tagEma: 18 | 50, throughEma: 18 | null): void {
  const approach = closeFor(sk, (em) => emaValue(em, tagEma) * 1.02);
  const prevClose = px(sk);
  push(sk, approach, () => ({
    o: Math.max(prevClose, approach * 1.006),
    h: Math.max(prevClose, approach * 1.006) * 1.003,
    l: approach * 0.996,
  }), 0.85);

  const barHigh = sk.h[at(sk)];
  const close = closeFor(sk, (em) => emaValue(em, tagEma) * 1.006);
  push(sk, close, (em) => {
    const ev = emaValue(em, tagEma);
    const low = ev * 0.994;
    const wanted = Math.max(close * 1.003, throughEma == null ? 0 : emaValue(em, throughEma) * 1.003);
    const high = Math.max(Math.min(wanted, barHigh * 0.998), close * 1.001);
    return { o: low + (close - low) * 0.25, h: high, l: low };
  }, 1.7);
}

/** Drift down to the support EMA, then a reversal candle whose tail pierces it and the prior low. */
function sketchReversal(sk: Sketch, emas: (50 | 100 | 200)[]): void {
  // Bounce off whichever listed EMA the price is nearest, approaching it from
  // above or below — by the time an adverse cross has fired the price is often
  // already under the slower EMAs.
  const listed = [...emas];
  const near = (p: 50 | 100 | 200) => Math.abs(emaSeries(sk, p)[at(sk)] - px(sk));
  const support = listed.reduce((best, p) => (near(p) < near(best) ? p : best), listed[0]);
  const series = emaSeries(sk, support);
  const above = () => px(sk) >= series[at(sk)] * 1.003;
  const nearEnough = () => px(sk) <= series[at(sk)] * 1.015;
  // Push away from the EMA first: the dip reads as a pullback rather than a slide,
  // and it leaves the 18–50 MACD with enough momentum to survive it.
  if (above()) drift(sk, 0.011, 3, 1.3);
  until(sk, above() ? -0.009 : 0.006, () => above() && nearEnough(), 30);

  const prevLow = sk.l[at(sk)];
  const close = closeFor(sk, (em) => emaValue(em, support) * 1.012);
  push(sk, close, (em) => {
    const ev = emaValue(em, support);
    return {
      o: ev * 1.004,
      h: close * 1.004,
      l: Math.min(ev * 0.991, prevLow * 0.996),
    };
  }, 1.8);
}

/** The fill bar for a buy stop, plus the spare bars the engine needs after it. */
function finishEntry(sk: Sketch, def: StrategyDef): void {
  if (def.trade.entry.mode === 'buy_stop') {
    const level = sk.h[at(sk)] + def.trade.entry.offset;
    const close = Math.max(level * 1.006, px(sk) * 1.006);
    push(sk, close, (_e, c, prev) => ({ o: prev * 1.001, h: Math.max(c, level) * 1.004, l: prev * 0.997 }), 1.5);
  }
  drift(sk, 0.004, 2);
}

/** Bars after the fill, shaped so the ExitSpec's own rule is what closes the trade. */
function exitRun(sk: Sketch, event: FanEntryEvent, exit: ExitSpec): void {
  const trade = event.trade;
  const entryPrice = event.entryPrice;
  const rSize = trade ? entryPrice - trade.stopPrice : entryPrice * 0.04;
  const trailing = exit.trailPivot || exit.trailEma != null;
  const fillBar = at(sk);

  if (!trailing) {
    const target = (trade?.targetPrice ?? entryPrice + 3 * rSize) * 1.004;
    const bars = Math.max(4, Math.min(9, (exit.maxHoldBars ?? 9) - 1));
    const stepPct = Math.pow(Math.max(target / px(sk), 1.01), 1 / bars) - 1;
    drift(sk, stepPct, bars, 1.2);
    drift(sk, 0.004, 3, 0.9);
    return;
  }

  // Far enough for breakeven and a few bars of trailing, close enough that the
  // pullback into the trail is a normal bar rather than a crater.
  const peak = entryPrice + 2.5 * rSize;
  const rise = 10;
  drift(sk, Math.pow(Math.max(peak / px(sk), 1.01), 1 / rise) - 1, rise, 1.2);

  const trailAt = (): number => {
    const i = at(sk);
    if (exit.trailPivot) return lastConfirmedPivotLow(sk.h, sk.l, i, fillBar) ?? entryPrice;
    return exit.trailEma === 18 ? sk.e18[i] : sk.e50[i];
  };
  for (let k = 0; k < 6; k++) {
    const level = Math.max(entryPrice, trailAt());
    const close = Math.max(px(sk) * 0.972, level * 1.002);
    const last = k === 5;
    push(sk, close, (em) => {
      const base = defaultShape(px(sk), close);
      const cut = Math.max(em.e100 * 1.002, Math.min(level, close) * 0.994);
      return { l: last ? Math.min(base.l, cut) : base.l };
    }, 1.1);
    if (sk.l[at(sk)] <= level) break;
  }
  drift(sk, 0.004, 3, 0.9);
}

function subjectOf(sk: Sketch): FanBacktestSubject {
  return {
    ticker: 'SKETCH',
    name: 'Schematic',
    closes: sk.c,
    opens: sk.o,
    highs: sk.h,
    lows: sk.l,
    volumes: sk.v,
  };
}

// ------------------------------------------------------------------ the model

const PHASE_FILL: Record<StepKind, string> = {
  candle: 'rgba(196,122,20,0.13)',
  instant: 'rgba(124,92,191,0.10)',
  tracker: 'rgba(15,157,143,0.12)',
  guard: 'rgba(139,146,152,0.10)',
};
const LEAD_FILL = 'rgba(154,161,168,0.08)';
const FILL_FILL = 'rgba(58,160,255,0.12)';
const TRADE_FILL = 'rgba(6,169,107,0.09)';
const C_STOP = '#e23d3d';
const C_ENTRY = '#06865a';
const C_TARGET = '#d9871f';

const RESET_TEXT: Record<string, string> = {
  hold: 'an earlier step stopped holding',
  max_wait: 'it waited longer than its max wait',
  lower_lows: 'the pullback made too many lower lows',
  guard: 'the guard was false on the trigger bar',
  gate: 'the 200-EMA was not rising at the fill',
  rejected: 'the stop was too close to the fill',
  pending_expired: 'the buy stop was never filled',
  pending_dropped: 'the fill was skipped (a trade was still open)',
  taken: 'the trade was taken',
};

function trailModeOf(exit: ExitSpec): 'pivot' | 'ema' | null {
  if (exit.trailPivot) return 'pivot';
  return exit.trailEma != null ? 'ema' : null;
}

function notesOf(config: FanBacktestConfig): string[] {
  const def = config.strategy;
  const exit = def.trade.exit;
  const trail = trailModeOf(exit);
  const notes: string[] = [describeStrategy(def)];
  const macdOn = exit.macdExit || def.steps.some((s) => s.type === 'macd_favorable');
  if (macdOn) {
    notes.push(trail
      ? '18–50 MACD must be favorable at entry; it does not cut a trailed trade.'
      : '18–50 MACD must be favorable at entry and will flatten if the line drops through signal.');
  }
  if (trail === 'ema') notes.push(`After ${exit.breakevenAtR ?? 1}R the stop follows the ${exit.trailEma}-EMA. Max hold does not cut while the slow fan holds.`);
  if (trail === 'pivot') notes.push('After entry the stop ratchets 2¢ under each newly confirmed pivot low.');
  if (!trail && exit.maxHoldBars != null) notes.push(`Max hold ${exit.maxHoldBars} bars — the schematic exits by then if the target is not tagged.`);
  const swing = def.steps.find((s) => s.type === 'pullback' && s.mode === 'swing');
  if (swing?.type === 'pullback' && swing.mode === 'swing' && swing.rearmOnNewHigh) {
    notes.push('After a new swing high the same episode can re-arm for another pullback tag.');
  }
  const filters: string[] = [];
  if ((config.ema200RisingBars ?? 0) > 0) filters.push(`200-EMA rising vs ${config.ema200RisingBars ?? 21} bars ago`);
  if ((config.minAvgVol ?? 0) > 0) filters.push('volume floor on');
  if ((config.minMarketCap ?? 0) > 0) filters.push('cap floor on');
  if (filters.length) notes.push(`Universe filters: ${filters.join(', ')}.`);
  const cash = config.startCash ?? 10_000;
  const months = config.windowMonths ?? 3;
  notes.push(`Swing account (not drawn): ${config.riskPct ?? 1}% of $${cash.toLocaleString()} per 1R, max ${config.maxPositions ?? 4} names, ${months === 0 ? 'all dated history' : `last ${months} month${months === 1 ? '' : 's'}`}.`);
  return notes;
}

/** The first step that never fired, from the deepest cursor the run reached. */
function failureOf(def: StrategyDef, run: StrategyRun): ExampleFailure {
  const index = Math.min(run.reached.stepIndex + 1, def.steps.length - 1);
  const step = def.steps[index];
  const last = [...run.trace].reverse().find((t) => t.stepIndex === index || t.stepIndex === index - 1);
  const why = last ? RESET_TEXT[last.reason] ?? last.reason : null;
  const reached = run.reached.stepIndex >= 0 ? ` The machine got as far as step ${run.reached.stepIndex + 1}.` : '';
  return {
    stepIndex: index,
    label: `${index + 1}. ${stepLabel(step)}`,
    detail: describeStep(step),
    message: why
      ? `Step ${index + 1} never completed the setup — ${why}.${reached}`
      : `Step ${index + 1} never fired on the sketch.${reached}`,
  };
}

function checksOf(def: StrategyDef, event: FanEntryEvent | null, run: StrategyRun, failure: ExampleFailure | null): ExampleCheck[] {
  return def.steps.map((step, i) => {
    const mark = event?.marks.find((m) => m.stepIndex === i) ?? null;
    const fired = mark != null || i <= run.reached.stepIndex;
    return {
      stepIndex: i,
      label: `${i + 1}. ${stepLabel(step)}`,
      detail: describeStep(step),
      ok: fired,
      bar: mark ? mark.bar : (i === run.reached.stepIndex ? run.reached.bar : null),
      reason: mark
        ? null
        : failure && failure.stepIndex === i
          ? failure.message
          : fired
            ? 'fired, but the setup reset before an entry'
            : 'never reached',
    };
  });
}

function emptyModel(def: StrategyDef, config: FanBacktestConfig): StrategyExampleModel {
  const exit = def.trade.exit;
  return {
    bars: [], ema18: [], ema50: [], ema100: [], ema200: [],
    macd: { line: [], signal: [], hist: [] },
    showMacd: exit.macdExit || def.steps.some((s) => s.type === 'macd_favorable'),
    phases: [], marks: [], levels: [], bands: [], checks: [], failure: null,
    title: `Textbook: ${def.name}`,
    caption: def.description ?? describeStrategy(def),
    notes: notesOf(config),
  };
}

/**
 * Grow the sketch and run the engine over it. Two passes: the first stops right
 * after the fill so the entry, stop and target are known; the sketch is then cut
 * back to the fill bar and an exit run shaped by the ExitSpec is appended.
 */
function sketchAndRun(config: FanBacktestConfig): { sk: Sketch; run: StrategyRun } {
  const def = config.strategy;
  const sk = newSketch();
  warmUp(sk);
  for (const step of def.steps) sketchStep(sk, step);
  finishEntry(sk, def);

  let run = runStrategy(subjectOf(sk), config, { trace: true });
  if (run.entries.length) {
    truncate(sk, run.entries[0].barIndex + 1);
    exitRun(sk, run.entries[0], def.trade.exit);
    const second = runStrategy(subjectOf(sk), config, { trace: true });
    if (second.entries.length) run = second;
  }
  return { sk, run };
}

/** Every entry the engine takes on the sketch; the example draws the first. */
export function exampleEntries(config: FanBacktestConfig): FanEntryEvent[] {
  return config.strategy.steps.length ? sketchAndRun(config).run.entries : [];
}

export function buildStrategyExample(config: FanBacktestConfig): StrategyExampleModel {
  const def = config.strategy;
  const model = emptyModel(def, config);
  if (!def.steps.length) {
    return { ...model, failure: { stepIndex: -1, label: 'No steps yet', detail: '', message: 'Add a step to see how it plays out.' } };
  }

  const { sk, run } = sketchAndRun(config);
  const event = run.entries[0] ?? null;
  const failure = event ? null : failureOf(def, run);
  const checks = checksOf(def, event, run, failure);
  const trade = event?.trade ?? null;
  const last = at(sk);

  const entryBar = event?.barIndex ?? last;
  const exitBar = trade?.exitBar ?? last;
  const anchored = event?.marks.find((m) => stepKindOf(def.steps[m.stepIndex]) !== 'instant'
    && stepKindOf(def.steps[m.stepIndex]) !== 'guard');
  const wanted = (anchored?.bar ?? entryBar) - 8;
  const from = Math.max(0, Math.max(entryBar - 62, Math.min(wanted, entryBar - 16)));
  const to = Math.min(last, exitBar + 3);
  const width = to - from + 1;

  const macd = macd1850(sk.e18, sk.e50);
  const bars: ExampleBar[] = [];
  for (let i = from; i <= to; i++) bars.push({ o: sk.o[i], h: sk.h[i], l: sk.l[i], c: sk.c[i], v: sk.v[i] });

  const marks: ExampleMark[] = [];
  const phases: ExamplePhase[] = [];
  let cursor = 0;
  if (event) {
    // One phase per bar the steps landed on: from the previous mark to this one.
    for (const m of event.marks) {
      const step = def.steps[m.stepIndex];
      const kind = stepKindOf(step);
      const bar = Math.max(from, Math.min(m.bar, to));
      marks.push({
        bar: bar - from,
        price: m.price,
        kind,
        label: `${m.stepIndex + 1} ${m.label}`,
        stepIndex: m.stepIndex,
        clamped: m.bar < from,
      });
      const end = bar - from;
      if (end < cursor) {
        const open = phases[phases.length - 1];
        if (open) open.label = `${open.label} + ${m.stepIndex + 1}`;
        continue;
      }
      phases.push({
        id: `step-${m.stepIndex}`,
        label: `${m.stepIndex + 1}. ${stepLabel(step)}`,
        from: cursor,
        to: end,
        fill: PHASE_FILL[kind],
      });
      cursor = end + 1;
    }
    if (entryBar - from >= cursor) {
      phases.push({ id: 'fill', label: 'Fill', from: cursor, to: entryBar - from, fill: FILL_FILL });
      cursor = entryBar - from + 1;
    }
    marks.push({ bar: entryBar - from, price: event.entryPrice, kind: 'entry', label: 'entry', stepIndex: null });
  }
  if (trade) {
    const end = Math.min(trade.exitBar, to) - from;
    if (end >= cursor) {
      phases.push({ id: 'trade', label: exitLabel(def.trade.exit), from: cursor, to: end, fill: TRADE_FILL });
      cursor = end + 1;
    }
    if (trade.exitBar <= to) {
      marks.push({ bar: trade.exitBar - from, price: trade.exitPrice, kind: 'exit', label: 'exit', stepIndex: null });
    }
  }
  if (cursor <= width - 1) {
    phases.push({ id: 'tail', label: failure ? 'No entry on the sketch' : 'After the trade', from: cursor, to: width - 1, fill: LEAD_FILL });
  }
  if (phases.length && phases[0].from > 0) {
    phases.unshift({ id: 'lead', label: 'Setup builds', from: 0, to: phases[0].from - 1, fill: LEAD_FILL });
  }
  if (!phases.length) phases.push({ id: 'lead', label: 'No entry on the sketch', from: 0, to: width - 1, fill: LEAD_FILL });

  const exit = def.trade.exit;
  const trail = trailModeOf(exit);
  const levels: ExampleLevel[] = [];
  const bands: ExampleBand[] = [];
  if (trade) {
    const rSize = trade.entryPrice - trade.stopPrice;
    levels.push({ price: trade.stopPrice, color: C_STOP, label: 'stop', dash: [4, 3] });
    levels.push({ price: trade.entryPrice, color: C_ENTRY, label: 'entry', dash: [2, 3] });
    if (!trail) {
      levels.push({ price: trade.targetPrice, color: C_TARGET, label: exit.targetWindow ? '2.5R' : `${exit.targetR}R`, dash: [6, 4] });
    }
    if (exit.breakevenAtR != null && exit.breakevenAtR > 0) {
      levels.push({ price: trade.entryPrice + exit.breakevenAtR * rSize, color: '#6b7280', label: `${exit.breakevenAtR}R / BE`, dash: [2, 4] });
    }
    if (exit.targetWindow && !trail) {
      bands.push({
        lo: trade.entryPrice + BUNN_WINDOW_LO * rSize,
        hi: trade.entryPrice + BUNN_WINDOW_HI * rSize,
        fill: 'rgba(217,135,31,0.12)',
        label: '2.5–3R window',
      });
    }
  }

  return {
    ...model,
    bars,
    ema18: sk.e18.slice(from, to + 1),
    ema50: sk.e50.slice(from, to + 1),
    ema100: sk.e100.slice(from, to + 1),
    ema200: sk.e200.slice(from, to + 1),
    macd: {
      line: macd.line.slice(from, to + 1),
      signal: macd.signal.slice(from, to + 1),
      hist: macd.hist.slice(from, to + 1),
    },
    phases,
    marks,
    levels,
    bands,
    checks,
    failure,
  };
}

function exitLabel(exit: ExitSpec): string {
  const trail = trailModeOf(exit);
  if (trail === 'pivot') return 'Trail pivots';
  if (trail === 'ema') return `Trail ${exit.trailEma}-EMA`;
  if (exit.targetWindow) return 'Run to 2.5R';
  return `Run to ${exit.targetR}R`;
}
