// strategy/engine.ts — walks a StrategyDef's steps over one subject's bars and
// returns entry events with one mark per step. One engine serves the backtest,
// the signal scan and the example chart.
//
// Per bar, in order:
//   1. HOLDS    every fired step with `hold` must still hold, else reset (the
//               chain still runs on this bar from step 1 — a reset never
//               blinds the machine to the bar that caused it)
//   2. TRACKER  swing state: new high re-arms / lower lows count (reset past max)
//   3. PENDING  a buy stop fills at its level (gates permitting) or expires
//   4. skip the chain during an open trade or on a new-high bar
//   5. REFRESH  a `refresh` step re-marks itself on a later firing
//   6. FIRE CHAIN  advance the cursor while steps fire (one candle per bar; a
//      tracker ends the bar it fires on — its bar is the swing high); a failing
//      guard cancels back to the last candle step; a step that outwaits
//      `maxWait` resets (unless the previous pullback run extends)
//
// Universal gates kept from the fixed strategies: 200-EMA rising at the fill,
// one open trade per name, MIN_R_FRAC rejection.

import { classifyFanAtIndex, ema200RisingAt, FAN_ENTER_LOOKBACK } from '../fan.ts';
import { ema, macd as classicMacd, rsi, stochRsi } from '../indicators.ts';
import type { FanBacktestConfig, FanBacktestSubject, FanEntryEvent } from '../fanBacktest.ts';
import { atr14, BUNN_WINDOW_LO, EMA_WARM, macd1850, MIN_R_FRAC, snapshotIndicators } from './primitives.ts';
import { compileSteps, describeStrategy, releasesHold, type CompiledStep, type Series } from './steps.ts';
import { simulateRTrade } from './trade.ts';
import type { StrategyDef, StrategyMark } from './types.ts';

export type StrategyResetReason =
  | 'hold'
  | 'max_wait'
  | 'lower_lows'
  | 'guard'
  | 'taken'
  | 'gate'
  | 'rejected'
  | 'pending_expired'
  | 'pending_dropped';

export interface StrategyTraceEntry {
  bar: number;
  stepId: string | null;
  stepIndex: number | null;
  reason: StrategyResetReason;
}

export interface StrategyRun {
  entries: FanEntryEvent[];
  trace: StrategyTraceEntry[];
  /** Deepest step that ever fired and the bar it fired on. `stepIndex` is -1 when nothing fired. */
  reached: { stepIndex: number; bar: number };
}

interface Tracker {
  idx: number;
  swingHigh: number;
  swingHighBar: number;
  lastLow: number;
  pullbackLow: number;
  lowerLows: number;
  maxLowerLows: number;
  rearm: boolean;
  armed: boolean;
  taken: boolean;
}

interface Pending {
  trigBar: number;
  buyStop: number;
  maxWait: number | null;
}

function forwardReturns(c: number[], i: number, horizons: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  const px = c[i];
  for (const h of horizons) {
    if (i + h < c.length && px > 0) out[h] = ((c[i + h] - px) / px) * 100;
  }
  return out;
}

function scanStart(def: StrategyDef): number {
  const near = def.steps.some((s) => s.type === 'fan_onset' && s.entry === 'near');
  return near ? EMA_WARM + FAN_ENTER_LOOKBACK : EMA_WARM;
}

/** first / highest-high / last bar among the anchored marks (the fill bar when none). */
export function derivedSetupBars(
  marks: StrategyMark[],
  steps: CompiledStep[],
  h: number[],
  fillBar: number,
): { fanBar: number; impulseBar: number; reactionBar: number } {
  const shaped = marks.filter((m) => steps[m.stepIndex]?.anchored);
  if (!shaped.length) return { fanBar: fillBar, impulseBar: fillBar, reactionBar: fillBar };
  let impulse = shaped[0];
  for (const m of shaped) if (h[m.bar] > h[impulse.bar]) impulse = m;
  return { fanBar: shaped[0].bar, impulseBar: impulse.bar, reactionBar: shaped[shaped.length - 1].bar };
}

export function runStrategy(
  subject: FanBacktestSubject,
  config: FanBacktestConfig,
  opts: { trace?: boolean } = {},
): StrategyRun {
  const def = config.strategy;
  const c = subject.closes;
  const o = subject.opens ?? c;
  const h = subject.highs ?? c;
  const l = subject.lows ?? c;
  const L = c.length;
  const start = scanStart(def);
  const entries: FanEntryEvent[] = [];
  const trace: StrategyTraceEntry[] = [];
  const reached = { stepIndex: -1, bar: -1 };
  // Leave one bar after the fill so the trade can be managed.
  if (L < start + 2 || def.steps.length === 0) return { entries, trace, reached };

  const e18 = ema(c, 18);
  const e50 = ema(c, 50);
  const e100 = ema(c, 100);
  const e200 = ema(c, 200);
  const macd = macd1850(e18, e50);
  const classic = classicMacd(c);
  const stoch = stochRsi(rsi(c, 14), 14, 3, 3);
  const atr = atr14(h, l, c);
  const series: Series = { o, h, l, c, e18, e50, e100, e200, macd, atr };
  const bars = { o, h, l, c };
  const emas = { e18, e50, e100, e200 };
  const steps = compileSteps(def.steps, series);
  const n = steps.length;
  const risingBars = config.ema200RisingBars ?? 21;
  const { entry, stop, exit } = def.trade;
  const summary = describeStrategy(def);
  const wantTrace = opts.trace === true;

  let cursor = 0;
  let marks: StrategyMark[] = [];
  let lastFireBar = -1;
  let tracker: Tracker | null = null;
  let pending: Pending | null = null;
  let lastExit = -1;

  const log = (bar: number, reason: StrategyResetReason, step: CompiledStep | null) => {
    if (wantTrace) trace.push({ bar, reason, stepId: step?.id ?? null, stepIndex: step?.index ?? null });
  };
  const markOf = (step: CompiledStep, i: number): StrategyMark => ({
    stepId: step.id, stepIndex: step.index, kind: step.kind, label: step.label, bar: i, price: step.price(i),
  });
  const reset = (i: number, reason: StrategyResetReason, step: CompiledStep | null) => {
    cursor = 0;
    marks = [];
    lastFireBar = -1;
    tracker = null;
    pending = null;
    log(i, reason, step);
  };
  /** Cancel back to the nearest preceding candle step (never past a live tracker). */
  const cancel = (i: number, reason: StrategyResetReason, step: CompiledStep) => {
    let k = 0;
    for (let j = cursor - 1; j >= 0; j--) {
      if (steps[j].kind === 'candle') { k = j; break; }
    }
    if (tracker) k = Math.max(k, tracker.idx + 1);
    marks.length = k;
    cursor = k;
    lastFireBar = k > 0 ? marks[k - 1].bar : -1;
    log(i, reason, step);
  };
  const released = (k: number): boolean => {
    for (let m = k + 1; m < cursor; m++) if (releasesHold(steps[m], steps[k])) return true;
    return false;
  };
  const stopPriceOf = (i: number, trigBar: number): number => {
    let base: number;
    if (stop.anchor === 'trigger_low') {
      base = l[trigBar];
    } else if (stop.anchor === 'mark_low') {
      const m = marks.find((x) => x.stepId === stop.stepId);
      base = m ? l[m.bar] : l[trigBar];
    } else {
      const shaped = marks.find((m) => steps[m.stepIndex].anchored);
      const from = tracker ? tracker.swingHighBar : (shaped?.bar ?? trigBar);
      base = Infinity;
      for (let k = Math.min(from, i); k <= i; k++) base = Math.min(base, l[k]);
    }
    if (stop.underEma50) base = Math.min(base, e50[i]);
    return base - stop.atrPad * (atr[i] ?? 0) - stop.offset;
  };
  const enter = (i: number, fill: number, trigBar: number): FanEntryEvent | null => {
    const stopPrice = stopPriceOf(i, trigBar);
    const rSize = fill - stopPrice;
    if (!(rSize > 0) || rSize / fill < MIN_R_FRAC) return null;
    const targetPrice = fill + (exit.targetWindow ? BUNN_WINDOW_LO : exit.targetR) * rSize;
    const sim = simulateRTrade(bars, emas, macd, i, stopPrice, targetPrice, exit, fill);
    const cls = classifyFanAtIndex(e18, e50, e100, e200, i);
    const eventMarks = marks.map((m) => ({ ...m }));
    const event: FanEntryEvent = {
      ticker: subject.ticker,
      name: subject.name,
      date: subject.dates?.[i] ?? null,
      barIndex: i,
      strategyId: def.id,
      strategyName: def.name,
      entryMode: entry.mode,
      summary,
      entryPrice: fill,
      worstGap: cls.worstGap,
      forwardReturns: forwardReturns(c, i, config.horizons),
      trade: sim ? { ...sim, exitDate: subject.dates?.[sim.exitBar] ?? null } : null,
      marks: eventMarks,
      ...derivedSetupBars(eventMarks, steps, h, i),
      indicators: snapshotIndicators(classic, stoch, i),
    };
    entries.push(event);
    if (tracker) tracker.taken = true;
    lastExit = sim?.exitBar ?? i;
    return event;
  };
  const afterEntry = (i: number) => {
    if (tracker) {
      tracker.armed = false;
      cursor = tracker.idx + 1;
      marks.length = tracker.idx + 1;
      lastFireBar = marks[tracker.idx].bar;
    } else {
      reset(i, 'taken', null);
    }
  };
  const trigger = (i: number) => {
    if (entry.mode === 'buy_stop') {
      pending = { trigBar: i, buyStop: h[i] + entry.offset, maxWait: entry.maxWait };
      return;
    }
    const last = steps[n - 1];
    if (!ema200RisingAt(e200, i, risingBars)) { cancel(i, 'gate', last); return; }
    const ev = enter(i, c[i], i);
    if (ev) afterEntry(i);
    else cancel(i, 'rejected', last);
  };

  for (let i = start; i < L - 1; i++) {
    // 1. HOLDS (a reset falls through: the chain restarts on this same bar)
    for (let k = 0; k < cursor; k++) {
      const s = steps[k];
      if (!s.hold || released(k)) continue;
      if (!s.holds(i)) { reset(i, 'hold', s); break; }
    }

    // 2. TRACKER
    let skipEvents = false;
    if (tracker) {
      const t: Tracker = tracker;
      if (h[i] >= t.swingHigh) {
        t.swingHigh = h[i];
        t.swingHighBar = i;
        t.lowerLows = 0;
        t.lastLow = l[i];
        t.pullbackLow = l[i];
        if (t.rearm) t.armed = true;
        marks[t.idx] = markOf(steps[t.idx], i);
        if (cursor === t.idx + 1) lastFireBar = i;
        skipEvents = true;
      } else if (t.armed) {
        if (l[i] < t.lastLow) {
          t.lowerLows += 1;
          t.lastLow = l[i];
          t.pullbackLow = Math.min(t.pullbackLow, l[i]);
        }
        if (t.lowerLows > t.maxLowerLows) { reset(i, 'lower_lows', steps[t.idx]); continue; }
      }
    }

    // 3. PENDING buy stop
    if (pending) {
      const p: Pending = pending;
      if (h[i] >= p.buyStop) {
        const ok = i > lastExit && ema200RisingAt(e200, i, risingBars);
        let ev: FanEntryEvent | null = null;
        if (ok) ev = enter(i, p.buyStop, p.trigBar);
        if (!ev) log(i, ok ? 'rejected' : 'pending_dropped', steps[n - 1]);
        pending = null;
        afterEntry(i);
      } else if (p.maxWait != null && i - p.trigBar >= p.maxWait) {
        pending = null;
        reset(i, 'pending_expired', steps[n - 1]);
      }
      continue;
    }

    // 4. Nothing fires during an open trade or on a new-high bar.
    if (i <= lastExit || skipEvents) continue;

    // 5. REFRESH — a later firing of the previous step moves its mark.
    if (cursor > 0 && cursor < n) {
      const prev = steps[cursor - 1];
      if (prev.refresh && prev.fires(i, cursor > 1 ? marks[cursor - 2].bar : -1)) {
        marks[cursor - 1] = markOf(prev, i);
        lastFireBar = i;
      }
    }

    // 6. FIRE CHAIN
    let candleUsed = false;
    while (cursor < n) {
      const cur = steps[cursor];
      if (cur.kind === 'candle' && candleUsed) break;
      if (tracker && !tracker.armed && cursor > tracker.idx) break;
      const prevBar = cursor > 0 ? marks[cursor - 1].bar : -1;
      if (!cur.fires(i, prevBar)) {
        if (cur.kind === 'guard') { cancel(i, 'guard', cur); break; }
        if (cursor > 0 && steps[cursor - 1].extends(i)) {
          marks[cursor - 1] = markOf(steps[cursor - 1], i);
          lastFireBar = i;
        } else if (cur.maxWait != null && i - lastFireBar >= cur.maxWait) {
          reset(i, 'max_wait', cur);
        }
        break;
      }
      marks.push(markOf(cur, i));
      if (cur.index >= reached.stepIndex) { reached.stepIndex = cur.index; reached.bar = i; }
      if (cur.kind === 'candle') candleUsed = true;
      if (cur.tracker) {
        tracker = {
          idx: cursor,
          swingHigh: h[i],
          swingHighBar: i,
          lastLow: l[i],
          pullbackLow: l[i],
          lowerLows: 0,
          maxLowerLows: cur.tracker.maxLowerLows,
          rearm: cur.tracker.rearmOnNewHigh,
          armed: true,
          taken: false,
        };
      }
      cursor += 1;
      lastFireBar = i;
      if (cursor === n) { trigger(i); break; }
      // The tracker's bar is the swing high; the pullback it watches starts next bar.
      if (cur.tracker) break;
    }
  }

  return { entries, trace, reached };
}

export function findStrategyEntries(
  subject: FanBacktestSubject,
  config: FanBacktestConfig,
  opts: { trace?: boolean } = {},
): FanEntryEvent[] {
  return runStrategy(subject, config, opts).entries;
}
