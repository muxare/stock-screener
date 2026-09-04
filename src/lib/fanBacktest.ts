// fanBacktest.ts — fan-episode detection + 1R/3R trade simulation.
//
// Strategies (long-only):
//   onset     — first bar of 18>50>100>200 (baseline)
//   cross     — 18 crosses up 50 while 50>100>200
//   tag18     — bounce off the 18 after that cross (bone zone)
//   tag50     — 50-EMA tag after the cross, ≤2 lower lows
//   structure — tag50 + reversal/rejection + 18-50 MACD window
//   dual_ema  — structure that tags both 18 and 50
//   bunn_bounce — fan-intact reversal on 50/100/200; buy stop 2¢ above the bar
//   bunn_cont   — 18 adversely crosses 50, bounce on 100/200, buy stop when the fan resumes
//
// Risk: 1R stop under the pullback / 50-EMA, padded by 0.25 ATR(14). Default
// management: move stop to breakeven at 1R, then trail the 50. MACD window is
// an entry filter only while trailing (it used to cut the trail). Continuation:
// another pullback after a new swing high, one open trade at a time.
// Swing account: last N months of those fills, sized at risk% of equity / 1R,
// capped concurrent names, until the window ends or equity hits zero.
// Illustrative only — no costs, slippage, or gap handling.

import { classifyFanAtIndex, ema200RisingAt, FAN_ENTER_LOOKBACK, type FanStatus } from './fan.ts';
import { ema, rsi, macd as classicMacd, stochRsi } from './indicators.ts';
import type { HorizonStat } from './market.ts';

export type FanStrategyId = 'onset' | 'cross' | 'tag18' | 'tag50' | 'structure' | 'dual_ema' | 'bunn_bounce' | 'bunn_cont';
/** Course “two pennies” offset for bounce buy-stops and stop wiggle. */
export const BUNN_PENNY = 0.02;
/** Mechanical target-window floor (exit). Cap 3R is unused for fill. */
export const BUNN_WINDOW_LO = 2.5;
export const BUNN_WINDOW_HI = 3;
export type FanEntrySignal = 'near' | 'match';

export const FAN_STRATEGIES: { id: FanStrategyId; label: string; hint: string }[] = [
  { id: 'onset', label: 'Fan onset (baseline)', hint: 'First bar the full 18>50>100>200 stack appears.' },
  { id: 'cross', label: 'Continuation cross', hint: '18 crosses up through 50 while 50>100>200 holds.' },
  { id: 'tag18', label: '18-EMA tag (bone zone)', hint: 'Pullback tags the 18 and closes back above it while the stack holds.' },
  { id: 'tag50', label: '50-EMA tag', hint: 'Bounce off the 50 after the cross; 0–2 lower lows, 50 still rising, 18>50>100>200.' },
  { id: 'structure', label: 'Full structure', hint: '50-tag + reversal or rejection wick + 18-50 MACD still favorable.' },
  { id: 'dual_ema', label: 'Dual-EMA test', hint: 'Full structure that trades through both 18 and 50.' },
  { id: 'bunn_bounce', label: 'Bunn bounce', hint: 'Fan-intact reversal on the 50, 100, or 200; buy stop 2¢ above the trigger; R = bar height + 2¢.' },
  { id: 'bunn_cont', label: 'Bunn continuation', hint: '18 adversely crosses 50, reversal bounce on 100 or 200, then buy stop 2¢ above the bar that resumes the full fan.' },
];

export interface FanBacktestConfig {
  strategy: FanStrategyId;
  /** Used only by onset (match vs approaching). */
  entry: FanEntrySignal;
  /** Target as a multiple of 1R. Ignored when trailEma is set. */
  targetR: number;
  /** Require 18-50 MACD line > signal on entry. Also exits on a flip unless trailing. */
  macdWindow: boolean;
  maxHoldBars: number | null;
  horizons: number[];
  /** Another pullback after a new swing high in the same slow-fan episode. Default true. */
  continueEpisode?: boolean;
  /** Move stop to entry once unrealized R reaches this. Default 1. null = off. */
  breakevenAtR?: number | null;
  /** After breakeven, trail under this EMA. null = hard targetR instead. */
  trailEma?: 18 | 50 | null;
  /** Exit at 2.5R (course window floor). Ignored when trailEma or trailPivot is set. Default false. */
  targetWindow?: boolean;
  /** After entry, trail 2¢ under newly confirmed pivot lows. Mutually exclusive with trailEma. Default false. */
  trailPivot?: boolean;
  /** ATR(14) fraction padded under the structural stop. Default 0.25. */
  stopAtrMult?: number;
  /** Same 20d avg-volume floor as the main filter bar. 0 = any. */
  minAvgVol?: number;
  /** Same market-cap floor as the main filter bar. 0 = any. Unknown cap fails. */
  minMarketCap?: number;
  /**
   * Require EMA200[i] > EMA200[i − N] at the fill. 0 = off.
   * 21 / 63 / 105 ≈ 1 / 3 / 5 months. Default 21.
   */
  ema200RisingBars?: number;
  /** Starting cash for the swing-account overlay. Default 10_000. */
  startCash?: number;
  /** Percent of equity risked per 1R. Default 1. */
  riskPct?: number;
  /** Max concurrent names. Default 4. */
  maxPositions?: number;
  /** Entry window in calendar months ending at the last bar. 0 = all dated history. Default 3. */
  windowMonths?: number;
}

export const DEFAULT_FAN_BACKTEST_CONFIG: FanBacktestConfig = {
  strategy: 'tag50',
  entry: 'match',
  targetR: 3,
  macdWindow: false,
  maxHoldBars: 20,
  horizons: [5, 10, 20, 40],
  continueEpisode: true,
  breakevenAtR: 1,
  trailEma: 50,
  targetWindow: false,
  trailPivot: false,
  stopAtrMult: 0.25,
  minAvgVol: 0,
  minMarketCap: 0,
  ema200RisingBars: 21,
  startCash: 10_000,
  riskPct: 1,
  maxPositions: 4,
  windowMonths: 3,
};

export type FanTradeExitReason =
  | 'stop_r'
  | 'target_r'
  | 'target_window'
  | 'breakeven'
  | 'trail'
  | 'pivot_trail'
  | 'macd_window'
  | 'slow_fan_break'
  | 'fan_break'
  | 'max_hold'
  | 'end_of_data';

export interface FanSimulatedTrade {
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  returnPct: number;
  realizedR: number;
  barsHeld: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  exitReason: FanTradeExitReason;
  /** Calendar date of exitBar when the subject carries dates. */
  exitDate?: string | null;
}

export interface FanEntryEvent {
  ticker: string;
  name: string;
  date: string | null;
  barIndex: number;
  strategy: FanStrategyId;
  signal: FanEntrySignal;
  entryPrice: number;
  worstGap: number;
  forwardReturns: Record<number, number>;
  trade: FanSimulatedTrade | null;
  /** First bar of this episode’s 18>50>100>200 stack (18/50 cross). */
  fanBar: number;
  /** Pullback tag / fill. Same as barIndex. */
  reactionBar: number;
  /** Swing high that the pullback came off. */
  impulseBar: number;
  /** Classic MACD (12/26/9) + Stoch RSI (14/14/3/3) at the entry bar. */
  indicators: FanEntryIndicators | null;
}

export interface FanEntryIndicators {
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  stochK: number;
  stochD: number;
}

export interface FanFactorBucket {
  factor: string;
  bucket: string;
  n: number;
  winRate: number;
  avgR: number;
}

export interface FanTradeSummary {
  count: number;
  winRate: number;
  avgReturnPct: number;
  medianReturnPct: number;
  avgR: number;
  medianR: number;
  hitTargetPct: number;
  avgBarsHeld: number;
  byExitReason: Partial<Record<FanTradeExitReason, number>>;
}

export type FanAccountEndReason = 'window' | 'ruin';

export interface FanAccountCurvePoint {
  date: string;
  equity: number;
}

export interface FanAccountFill {
  shares: number;
  pnl: number;
  equityAfter: number;
  event: FanEntryEvent;
}

export interface FanAccountResult {
  startCash: number;
  endEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  taken: number;
  skipped: { total: number; noCash: number; maxPositions: number };
  endReason: FanAccountEndReason;
  windowStart: string | null;
  windowEnd: string | null;
  candidates: number;
  curve: FanAccountCurvePoint[];
  fills: FanAccountFill[];
}

export interface FanBacktestResult {
  config: FanBacktestConfig;
  universe: number;
  stocksScanned: number;
  totalEntries: number;
  stocksWithEntries: number;
  forwardHorizons: HorizonStat[];
  trades: FanTradeSummary;
  entries: FanEntryEvent[];
  /** Win rate / avg R by MACD and Stoch RSI state at entry. */
  factors: FanFactorBucket[];
  /** Cash book using the same fills, last N months, until the window or ruin. */
  account: FanAccountResult;
}

export interface FanBacktestProgress { name: number; total: number; }

export interface FanBacktestSubject {
  ticker: string;
  name: string;
  closes: number[];
  opens?: number[];
  highs?: number[];
  lows?: number[];
  dates?: string[];
  volumes?: number[];
  /** Precomputed 20d average volume (same field the screener filters on). */
  avgVol20?: number;
  marketCap?: number | null;
}

const EMA_WARM = 200;
const MIN_R_FRAC = 0.0015;

export function macd1850(e18: number[], e50: number[]): { line: number[]; signal: number[]; hist: number[] } {
  const line = e18.map((v, i) => v - e50[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

export function slowFanUp(e50: number[], e100: number[], e200: number[], i: number): boolean {
  return e50[i] > e100[i] && e100[i] > e200[i];
}

/** Image uptrend fan: 18 > 50 > 100 > 200. */
export function fullFanUp(e18: number[], e50: number[], e100: number[], e200: number[], i: number): boolean {
  return e18[i] > e50[i] && slowFanUp(e50, e100, e200, i);
}

function isFiniteNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function snapshotIndicators(
  classic: { line: number[]; signal: number[]; hist: number[] },
  stoch: { k: (number | null)[]; d: (number | null)[] },
  i: number,
): FanEntryIndicators | null {
  const macdLine = classic.line[i];
  const macdSignal = classic.signal[i];
  const macdHist = classic.hist[i];
  const stochK = stoch.k[i];
  const stochD = stoch.d[i];
  if (!isFiniteNum(macdLine) || !isFiniteNum(macdSignal) || !isFiniteNum(macdHist)
    || !isFiniteNum(stochK) || !isFiniteNum(stochD)) {
    return null;
  }
  return { macdLine, macdSignal, macdHist, stochK, stochD };
}

export function avgVol20Of(s: FanBacktestSubject): number {
  if (s.avgVol20 != null && Number.isFinite(s.avgVol20)) return s.avgVol20;
  const vols = s.volumes ?? [];
  if (!vols.length) return 0;
  const n = Math.min(20, vols.length);
  let sum = 0;
  for (let i = vols.length - n; i < vols.length; i++) sum += vols[i] ?? 0;
  return sum / n;
}

/** Same rules as `applyFanFilters` for volume and market cap. 200-EMA slope is checked per fill, not here. */
export function passesFanUniverseFilters(s: FanBacktestSubject, config: FanBacktestConfig): boolean {
  const minVol = config.minAvgVol ?? 0;
  const minCap = config.minMarketCap ?? 0;
  if (minVol > 0) {
    const avg = avgVol20Of(s);
    if (!Number.isFinite(avg) || avg < minVol) return false;
  }
  if (minCap > 0) {
    if (s.marketCap == null || !Number.isFinite(s.marketCap) || s.marketCap < minCap) return false;
  }
  return true;
}

export function correlateFanFactors(entries: FanEntryEvent[]): FanFactorBucket[] {
  const specs: { factor: string; bucket: string; test: (ind: FanEntryIndicators) => boolean }[] = [
    { factor: 'MACD hist', bucket: '> 0', test: (ind) => ind.macdHist > 0 },
    { factor: 'MACD hist', bucket: '≤ 0', test: (ind) => ind.macdHist <= 0 },
    { factor: 'MACD line vs signal', bucket: 'line > signal', test: (ind) => ind.macdLine > ind.macdSignal },
    { factor: 'MACD line vs signal', bucket: 'line ≤ signal', test: (ind) => ind.macdLine <= ind.macdSignal },
    { factor: 'Stoch RSI %K', bucket: '< 20', test: (ind) => ind.stochK < 20 },
    { factor: 'Stoch RSI %K', bucket: '20–80', test: (ind) => ind.stochK >= 20 && ind.stochK <= 80 },
    { factor: 'Stoch RSI %K', bucket: '> 80', test: (ind) => ind.stochK > 80 },
    { factor: 'Stoch RSI %K vs %D', bucket: '%K > %D', test: (ind) => ind.stochK > ind.stochD },
    { factor: 'Stoch RSI %K vs %D', bucket: '%K ≤ %D', test: (ind) => ind.stochK <= ind.stochD },
  ];
  const usable = entries.filter((e) => e.trade && e.indicators);
  return specs.map((s) => {
    const hit = usable.filter((e) => s.test(e.indicators!));
    const n = hit.length;
    const rs = hit.map((e) => e.trade!.realizedR);
    return {
      factor: s.factor,
      bucket: s.bucket,
      n,
      winRate: n ? (rs.filter((r) => r > 0).length / n) * 100 : 0,
      avgR: n ? rs.reduce((a, b) => a + b, 0) / n : 0,
    };
  });
}

export function crossUp18_50(e18: number[], e50: number[], i: number): boolean {
  return i > 0 && e18[i - 1] <= e50[i - 1] && e18[i] > e50[i];
}

export function crossDown18_50(e18: number[], e50: number[], i: number): boolean {
  return i > 0 && e18[i - 1] >= e50[i - 1] && e18[i] < e50[i];
}

export function isLongReversal(o: number[], h: number[], c: number[], i: number): boolean {
  return i >= 1 && h[i] < h[i - 1] && c[i] > o[i] && o[i - 1] > c[i - 1];
}

/** Bunn long reversal: body above EMA support, tail through it and the prior low. */
export function isBunnLongReversal(o: number[], l: number[], c: number[], ma: number[], i: number): boolean {
  if (i < 1) return false;
  const e = ma[i];
  const open = o[i];
  const close = c[i];
  const low = l[i];
  const priorLow = l[i - 1];
  if (![e, open, close, low, priorLow].every(Number.isFinite)) return false;
  return open > e && close > e && low < e && low < priorLow;
}

/** 3-bar long pivot: previous and subsequent lows are both higher than low[i]. */
export function isLongPivotCandidate(l: number[], i: number): boolean {
  if (i < 1 || i + 1 >= l.length) return false;
  const prev = l[i - 1];
  const pivot = l[i];
  const next = l[i + 1];
  if (![prev, pivot, next].every(Number.isFinite)) return false;
  return prev > pivot && next > pivot;
}

/**
 * First bar at or after `fromBar` (and at least i+2) whose high exceeds high[i-1].
 * Null if `i` is not a candidate or the prior high is never taken out.
 */
export function longPivotConfirmBar(h: number[], l: number[], i: number, fromBar: number): number | null {
  if (!isLongPivotCandidate(l, i)) return null;
  const priorHigh = h[i - 1];
  if (!Number.isFinite(priorHigh)) return null;
  const n = Math.min(h.length, l.length);
  const start = Math.max(fromBar, i + 2);
  for (let k = start; k < n; k++) {
    if (Number.isFinite(h[k]) && h[k] > priorHigh) return k;
  }
  return null;
}

/** Most recent confirmed pivot low visible as of `asOfBar` (inclusive). */
export function lastConfirmedPivotLow(
  h: number[], l: number[], asOfBar: number, confirmAfterBar = -1,
): number | null {
  const n = Math.min(h.length, l.length);
  let bestI = -1;
  let bestLow: number | null = null;
  for (let i = 1; i + 1 < asOfBar && i + 1 < n; i++) {
    const k = longPivotConfirmBar(h, l, i, 0);
    if (k == null || k > asOfBar || k <= confirmAfterBar) continue;
    if (i > bestI) {
      bestI = i;
      bestLow = l[i];
    }
  }
  return bestLow;
}

/** Close-back-above the MA with the close in the upper 40% of the bar. */
export function isMaBounce(o: number[], h: number[], l: number[], c: number[], ma: number[], i: number): boolean {
  const range = h[i] - l[i];
  if (!(range > 0)) return false;
  return l[i] <= ma[i] && c[i] >= ma[i] && c[i] > o[i] && (c[i] - l[i]) / range >= 0.6;
}

export function atr14(h: number[], l: number[], c: number[]): number[] {
  const tr = c.map((_, i) => {
    if (i === 0) return Math.max(h[0] - l[0], 0);
    return Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  });
  return ema(tr, 14);
}

function slopeUp(arr: number[], i: number, n = 5): boolean {
  return i >= n && arr[i] > arr[i - n];
}

function trailEmaOf(config: FanBacktestConfig): 18 | 50 | null {
  return config.trailEma === 18 || config.trailEma === 50 ? config.trailEma : null;
}

function breakevenAt(config: FanBacktestConfig): number | null {
  if (config.breakevenAtR === null) return null;
  if (config.breakevenAtR === undefined) return 1;
  return config.breakevenAtR > 0 ? config.breakevenAtR : null;
}

function ema200RisingBarsOf(config: FanBacktestConfig): number {
  return config.ema200RisingBars ?? 21;
}

function ohlc(s: FanBacktestSubject) {
  const c = s.closes;
  return { o: s.opens ?? c, h: s.highs ?? c, l: s.lows ?? c, c };
}

function scanStart(strategy: FanStrategyId, entry: FanEntrySignal): number {
  if (strategy === 'onset' && entry === 'near') return EMA_WARM + FAN_ENTER_LOOKBACK;
  return EMA_WARM;
}

function statHorizon(arr: number[]): Omit<HorizonStat, 'h'> {
  const n = arr.length;
  if (!n) return { n: 0, avg: 0, median: 0, winRate: 0, best: 0, worst: 0 };
  const sorted = arr.slice().sort((a, b) => a - b);
  const avg = arr.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, avg, median, winRate: (arr.filter((x) => x > 0).length / n) * 100, best: sorted[n - 1], worst: sorted[0] };
}

function statusAt(e18: number[], e50: number[], e100: number[], e200: number[], i: number): FanStatus {
  return classifyFanAtIndex(e18, e50, e100, e200, i).status;
}

function macdFav(macd: { line: number[]; signal: number[]; hist: number[] }, i: number): boolean {
  return macd.line[i] > macd.signal[i] && macd.hist[i] >= 0;
}

function forwardReturns(c: number[], i: number, horizons: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  const px = c[i];
  for (const h of horizons) {
    if (i + h < c.length && px > 0) out[h] = ((c[i + h] - px) / px) * 100;
  }
  return out;
}

export function simulateRTrade(
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  emas: { e18: number[]; e50: number[]; e100: number[]; e200: number[] },
  macd: { line: number[]; signal: number[]; hist: number[] },
  entryBar: number,
  stopPrice: number,
  targetPrice: number,
  config: FanBacktestConfig,
  fullFanExit: boolean,
  fillPrice?: number,
): FanSimulatedTrade | null {
  const entryPrice = fillPrice ?? bars.c[entryBar];
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!(stopPrice < entryPrice)) return null;
  const rSize = entryPrice - stopPrice;
  if (rSize / entryPrice < MIN_R_FRAC) return null;
  const trailPivot = config.trailPivot === true;
  const trailEma = trailPivot ? null : trailEmaOf(config);
  const trailing = trailEma != null || trailPivot;
  const windowOn = config.targetWindow === true && !trailing;
  const exitLevel = windowOn ? entryPrice + BUNN_WINDOW_LO * rSize : targetPrice;
  if (!trailing && !(exitLevel > entryPrice)) return null;

  let stop = stopPrice;
  const beAt = breakevenAt(config);
  let maxFav = 0;
  let maxAdv = 0;
  const last = bars.c.length - 1;

  for (let j = entryBar + 1; j <= last; j++) {
    maxFav = Math.max(maxFav, ((bars.h[j] - entryPrice) / entryPrice) * 100);
    maxAdv = Math.min(maxAdv, ((bars.l[j] - entryPrice) / entryPrice) * 100);

    const hitStop = bars.l[j] <= stop;
    const hitTarget = !trailing && bars.h[j] >= exitLevel;
    if (hitStop && hitTarget) {
      return finish(entryBar, j, entryPrice, stopPrice, stopPrice, targetPrice, -1, maxFav, maxAdv, 'stop_r');
    }
    if (hitStop) {
      const raised = stop > stopPrice + 1e-12;
      const reason: FanTradeExitReason = trailPivot && raised
        ? 'pivot_trail'
        : stop > entryPrice + 1e-12 ? 'trail' : Math.abs(stop - entryPrice) < 1e-12 ? 'breakeven' : 'stop_r';
      const realizedR = (stop - entryPrice) / rSize;
      return finish(entryBar, j, entryPrice, stop, stopPrice, targetPrice, realizedR, maxFav, maxAdv, reason);
    }
    if (hitTarget) {
      if (windowOn) {
        return finish(entryBar, j, entryPrice, exitLevel, stopPrice, exitLevel, BUNN_WINDOW_LO, maxFav, maxAdv, 'target_window');
      }
      return finish(entryBar, j, entryPrice, targetPrice, stopPrice, targetPrice, config.targetR, maxFav, maxAdv, 'target_r');
    }
    if (config.macdWindow && !trailing && macd.line[j] < macd.signal[j]) {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'macd_window');
    }
    if (fullFanExit && statusAt(emas.e18, emas.e50, emas.e100, emas.e200, j) !== 'match') {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'fan_break');
    }
    if (!fullFanExit && !slowFanUp(emas.e50, emas.e100, emas.e200, j)) {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'slow_fan_break');
    }
    const skipHold = trailing && slowFanUp(emas.e50, emas.e100, emas.e200, j);
    if (!skipHold && config.maxHoldBars != null && j - entryBar >= config.maxHoldBars) {
      return finish(entryBar, j, entryPrice, bars.c[j], stopPrice, targetPrice, (bars.c[j] - entryPrice) / rSize, maxFav, maxAdv, 'max_hold');
    }

    if (beAt != null && bars.h[j] >= entryPrice + beAt * rSize) {
      stop = Math.max(stop, entryPrice);
    }
    if (stop >= entryPrice - 1e-12 && trailEma != null) {
      const t = trailEma === 18 ? emas.e18[j] : emas.e50[j];
      if (Number.isFinite(t)) stop = Math.max(stop, t);
    }
    if (trailPivot) {
      const p = lastConfirmedPivotLow(bars.h, bars.l, j, entryBar);
      if (p != null) stop = Math.max(stop, p - BUNN_PENNY);
    }
  }

  const exitPrice = bars.c[last];
  return finish(entryBar, last, entryPrice, exitPrice, stopPrice, targetPrice, (exitPrice - entryPrice) / rSize, maxFav, maxAdv, 'end_of_data');
}

function finish(
  entryBar: number, exitBar: number, entryPrice: number, exitPrice: number,
  stopPrice: number, targetPrice: number, realizedR: number,
  maxFav: number, maxAdv: number, exitReason: FanTradeExitReason,
): FanSimulatedTrade {
  return {
    entryBar, exitBar, entryPrice, exitPrice, stopPrice, targetPrice,
    returnPct: ((exitPrice - entryPrice) / entryPrice) * 100,
    realizedR, barsHeld: exitBar - entryBar, maxFavorablePct: maxFav, maxAdversePct: maxAdv, exitReason,
  };
}

interface Episode {
  crossBar: number;
  swingHigh: number;
  swingHighBar: number;
  pullbackLow: number;
  lastPullbackLow: number;
  lowerLows: number;
  taken: boolean;
}

function maybeEnter(
  strategy: FanStrategyId,
  i: number,
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  e18: number[], e50: number[], e200: number[],
  macd: { line: number[]; signal: number[]; hist: number[] },
  ep: Episode,
  macdWindow: boolean,
  ema200RisingBars: number,
): boolean {
  const tag50 = bars.l[i] <= e50[i] && bars.c[i] >= e50[i];
  const tag18 = bars.l[i] <= e18[i] && bars.c[i] >= e18[i];
  const dual = tag50 && bars.h[i] >= e18[i];
  const rev = isLongReversal(bars.o, bars.h, bars.c, i);
  const bounce = isMaBounce(bars.o, bars.h, bars.l, bars.c, e50, i);
  const macdOk = !macdWindow || macdFav(macd, i);
  const pullbackOk = ep.lowerLows <= 2;
  const rising50 = slopeUp(e50, i);

  if (!ema200RisingAt(e200, i, ema200RisingBars)) return false;
  if (strategy === 'cross') return i === ep.crossBar;
  if (i === ep.crossBar) return false;
  if (!rising50) return false;
  if (!(e18[i] > e50[i])) return false;
  if (strategy === 'tag18') return pullbackOk && tag18 && macdOk;
  if (strategy === 'tag50') return pullbackOk && tag50 && macdOk;
  if (strategy === 'structure') return pullbackOk && tag50 && (rev || bounce) && macdOk;
  if (strategy === 'dual_ema') return pullbackOk && dual && (rev || bounce) && macdOk;
  return false;
}

export function findFanEntries(
  subject: FanBacktestSubject,
  config: FanBacktestConfig = DEFAULT_FAN_BACKTEST_CONFIG,
): FanEntryEvent[] {
  const bars = ohlc(subject);
  const { c } = bars;
  const L = c.length;
  const start = scanStart(config.strategy, config.entry);
  // Leave one bar after the fill so the trade can be managed. Do not reserve
  // horizon bars — that used to clip the last ~40 sessions, which emptied a
  // 3-month account window.
  if (L < start + 2) return [];

  const e18 = ema(c, 18);
  const e50 = ema(c, 50);
  const e100 = ema(c, 100);
  const e200 = ema(c, 200);
  const macd = macd1850(e18, e50);
  const classic = classicMacd(c);
  const stoch = stochRsi(rsi(c, 14), 14, 3, 3);
  const emas = { e18, e50, e100, e200 };

  const atrs = atr14(bars.h, bars.l, bars.c);
  if (config.strategy === 'onset') return findOnset(subject, bars, emas, macd, classic, stoch, atrs, config, start);
  if (config.strategy === 'bunn_bounce') return findBunnBounce(subject, bars, emas, macd, classic, stoch, atrs, config, start);
  if (config.strategy === 'bunn_cont') return findBunnCont(subject, bars, emas, macd, classic, stoch, atrs, config, start);

  const out: FanEntryEvent[] = [];
  let ep: Episode | null = null;
  let lastExit = -1;
  const continueEpisode = config.continueEpisode !== false;
  const end = L - 1;

  for (let i = start; i < end; i++) {
    if (crossUp18_50(e18, e50, i) && slowFanUp(e50, e100, e200, i)) {
      ep = {
        crossBar: i,
        swingHigh: bars.h[i],
        swingHighBar: i,
        pullbackLow: bars.l[i],
        lastPullbackLow: bars.l[i],
        lowerLows: 0,
        taken: false,
      };
      if (i > lastExit && maybeEnter(config.strategy, i, bars, e18, e50, e200, macd, ep, config.macdWindow, ema200RisingBarsOf(config))) {
        const ev = pushEntry(out, subject, bars, emas, macd, classic, stoch, atrs, config, i, ep.pullbackLow, false, {
          fanBar: ep.crossBar, impulseBar: ep.swingHighBar,
        });
        if (ev) {
          ep.taken = true;
          if (ev.trade) lastExit = ev.trade.exitBar;
        }
      }
      continue;
    }
    if (!ep) continue;
    if (!fullFanUp(e18, e50, e100, e200, i)) { ep = null; continue; }

    if (bars.h[i] >= ep.swingHigh) {
      ep.swingHigh = bars.h[i];
      ep.swingHighBar = i;
      ep.lowerLows = 0;
      ep.lastPullbackLow = bars.l[i];
      ep.pullbackLow = bars.l[i];
      if (continueEpisode) ep.taken = false;
      continue;
    }

    if (ep.taken) continue;

    if (bars.l[i] < ep.lastPullbackLow) {
      ep.lowerLows += 1;
      ep.lastPullbackLow = bars.l[i];
      ep.pullbackLow = Math.min(ep.pullbackLow, bars.l[i]);
    }
    if (ep.lowerLows > 2) { ep = null; continue; }

    if (i <= lastExit) continue;

    if (maybeEnter(config.strategy, i, bars, e18, e50, e200, macd, ep, config.macdWindow, ema200RisingBarsOf(config))) {
      const ev = pushEntry(out, subject, bars, emas, macd, classic, stoch, atrs, config, i, ep.pullbackLow, false, {
        fanBar: ep.crossBar, impulseBar: ep.swingHighBar,
      });
      if (ev) {
        ep.taken = true;
        if (ev.trade) lastExit = ev.trade.exitBar;
      }
    }
  }
  return out;
}

function bunnBounceAt(
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  e50: number[], e100: number[], e200: number[],
  i: number,
): boolean {
  if (!slowFanUp(e50, e100, e200, i)) return false;
  return isBunnLongReversal(bars.o, bars.l, bars.c, e50, i)
    || isBunnLongReversal(bars.o, bars.l, bars.c, e100, i)
    || isBunnLongReversal(bars.o, bars.l, bars.c, e200, i);
}

function findBunnBounce(
  subject: FanBacktestSubject,
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  emas: { e18: number[]; e50: number[]; e100: number[]; e200: number[] },
  macd: ReturnType<typeof macd1850>,
  classic: ReturnType<typeof classicMacd>,
  stoch: ReturnType<typeof stochRsi>,
  atrs: number[],
  config: FanBacktestConfig,
  start: number,
): FanEntryEvent[] {
  const out: FanEntryEvent[] = [];
  const { e50, e100, e200 } = emas;
  const L = bars.c.length;
  let lastExit = -1;
  let pending: { trigger: number; buyStop: number; height: number } | null = null;

  for (let i = start; i < L - 1; i++) {
    if (pending) {
      if (!slowFanUp(e50, e100, e200, i)) {
        pending = null;
        continue;
      }
      if (bars.h[i] >= pending.buyStop) {
        if (config.macdWindow && !macdFav(macd, i)) { pending = null; continue; }
        if (!ema200RisingAt(e200, i, ema200RisingBarsOf(config))) { pending = null; continue; }
        const fillPrice = pending.buyStop;
        const stopPrice = fillPrice - (pending.height + BUNN_PENNY);
        const ev = pushEntry(out, subject, bars, emas, macd, classic, stoch, atrs, config, i, stopPrice, false, {
          fanBar: pending.trigger,
          impulseBar: Math.max(0, pending.trigger - 1),
          reactionBar: pending.trigger,
          fillPrice,
          stopPrice,
        });
        pending = null;
        if (ev?.trade) lastExit = ev.trade.exitBar;
      }
      continue;
    }
    if (i <= lastExit || i >= L - 2) continue;
    if (!bunnBounceAt(bars, e50, e100, e200, i)) continue;
    const height = bars.h[i] - bars.l[i];
    if (!(height > 0)) continue;
    pending = { trigger: i, buyStop: bars.h[i] + BUNN_PENNY, height };
  }
  return out;
}

function bunnSlowBounceAt(
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  e100: number[], e200: number[],
  i: number,
): boolean {
  return isBunnLongReversal(bars.o, bars.l, bars.c, e100, i)
    || isBunnLongReversal(bars.o, bars.l, bars.c, e200, i);
}

function findBunnCont(
  subject: FanBacktestSubject,
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  emas: { e18: number[]; e50: number[]; e100: number[]; e200: number[] },
  macd: ReturnType<typeof macd1850>,
  classic: ReturnType<typeof classicMacd>,
  stoch: ReturnType<typeof stochRsi>,
  atrs: number[],
  config: FanBacktestConfig,
  start: number,
): FanEntryEvent[] {
  const out: FanEntryEvent[] = [];
  const { e18, e50, e100, e200 } = emas;
  const L = bars.c.length;
  let lastExit = -1;
  let ep: { adverseBar: number; bounceBar: number | null; bounceLow: number } | null = null;
  let pending: {
    buyStop: number; stopPrice: number;
    fanBar: number; reactionBar: number; impulseBar: number;
  } | null = null;

  for (let i = start; i < L - 1; i++) {
    if (pending) {
      if (!slowFanUp(e50, e100, e200, i)) {
        pending = null;
        continue;
      }
      if (bars.h[i] >= pending.buyStop) {
        if (config.macdWindow && !macdFav(macd, i)) { pending = null; continue; }
        if (!ema200RisingAt(e200, i, ema200RisingBarsOf(config))) { pending = null; continue; }
        const ev = pushEntry(out, subject, bars, emas, macd, classic, stoch, atrs, config, i, pending.stopPrice, false, {
          fanBar: pending.fanBar,
          impulseBar: pending.impulseBar,
          reactionBar: pending.reactionBar,
          fillPrice: pending.buyStop,
          stopPrice: pending.stopPrice,
        });
        pending = null;
        if (ev?.trade) lastExit = ev.trade.exitBar;
      }
      continue;
    }

    if (ep) {
      if (!slowFanUp(e50, e100, e200, i)) {
        ep = null;
        continue;
      }
      if (bunnSlowBounceAt(bars, e100, e200, i)) {
        ep.bounceBar = i;
        ep.bounceLow = bars.l[i];
      }
      if (crossUp18_50(e18, e50, i) && fullFanUp(e18, e50, e100, e200, i)) {
        if (ep.bounceBar != null && i < L - 2 && i > lastExit) {
          const buyStop = bars.h[i] + BUNN_PENNY;
          const stopPrice = ep.bounceLow - BUNN_PENNY;
          if (stopPrice < buyStop) {
            pending = {
              buyStop, stopPrice,
              fanBar: ep.adverseBar,
              reactionBar: ep.bounceBar,
              impulseBar: i,
            };
          }
        }
        ep = null;
      }
      continue;
    }

    if (i <= lastExit) continue;
    if (crossDown18_50(e18, e50, i) && slowFanUp(e50, e100, e200, i)) {
      ep = { adverseBar: i, bounceBar: null, bounceLow: NaN };
      if (bunnSlowBounceAt(bars, e100, e200, i)) {
        ep.bounceBar = i;
        ep.bounceLow = bars.l[i];
      }
    }
  }
  return out;
}

function findOnset(
  subject: FanBacktestSubject,
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  emas: { e18: number[]; e50: number[]; e100: number[]; e200: number[] },
  macd: ReturnType<typeof macd1850>,
  classic: ReturnType<typeof classicMacd>,
  stoch: ReturnType<typeof stochRsi>,
  atrs: number[],
  config: FanBacktestConfig,
  start: number,
): FanEntryEvent[] {
  const out: FanEntryEvent[] = [];
  let prev = statusAt(emas.e18, emas.e50, emas.e100, emas.e200, start - 1);
  const want = config.entry;
  let lastExit = -1;
  for (let i = start; i < bars.c.length - 1; i++) {
    const now = statusAt(emas.e18, emas.e50, emas.e100, emas.e200, i);
    if (now === want && prev !== want) {
      if (config.macdWindow && !macdFav(macd, i)) { prev = now; continue; }
      if (!ema200RisingAt(emas.e200, i, ema200RisingBarsOf(config))) { prev = now; continue; }
      if (i <= lastExit) { prev = now; continue; }
      const stop = Math.min(bars.l[i], emas.e50[i]);
      const ev = pushEntry(out, subject, bars, emas, macd, classic, stoch, atrs, config, i, stop, true);
      if (ev?.trade) lastExit = ev.trade.exitBar;
    }
    prev = now;
  }
  return out;
}

function pushEntry(
  out: FanEntryEvent[],
  subject: FanBacktestSubject,
  bars: { o: number[]; h: number[]; l: number[]; c: number[] },
  emas: { e18: number[]; e50: number[]; e100: number[]; e200: number[] },
  macd: ReturnType<typeof macd1850>,
  classic: ReturnType<typeof classicMacd>,
  stoch: ReturnType<typeof stochRsi>,
  atrs: number[],
  config: FanBacktestConfig,
  i: number,
  stopHint: number,
  fullFanExit: boolean,
  setup?: { fanBar: number; impulseBar: number; reactionBar?: number; fillPrice?: number; stopPrice?: number },
): FanEntryEvent | null {
  const entryPrice = setup?.fillPrice ?? bars.c[i];
  const pad = (config.stopAtrMult ?? 0.25) * (atrs[i] ?? 0);
  const stopPrice = setup?.stopPrice ?? (Math.min(stopHint, emas.e50[i]) - pad);
  const rSize = entryPrice - stopPrice;
  if (!(rSize > 0) || rSize / entryPrice < MIN_R_FRAC) return null;
  const targetMult = config.targetWindow ? BUNN_WINDOW_LO : config.targetR;
  const targetPrice = entryPrice + targetMult * rSize;
  const cls = classifyFanAtIndex(emas.e18, emas.e50, emas.e100, emas.e200, i);
  const sim = simulateRTrade(bars, emas, macd, i, stopPrice, targetPrice, config, fullFanExit, setup?.fillPrice);
  const event: FanEntryEvent = {
    ticker: subject.ticker,
    name: subject.name,
    date: subject.dates?.[i] ?? null,
    barIndex: i,
    strategy: config.strategy,
    signal: config.entry,
    entryPrice,
    worstGap: cls.worstGap,
    forwardReturns: forwardReturns(bars.c, i, config.horizons),
    trade: sim ? { ...sim, exitDate: subject.dates?.[sim.exitBar] ?? null } : null,
    fanBar: setup?.fanBar ?? i,
    reactionBar: setup?.reactionBar ?? i,
    impulseBar: setup?.impulseBar ?? i,
    indicators: snapshotIndicators(classic, stoch, i),
  };
  out.push(event);
  return event;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function summarizeTrades(trades: FanSimulatedTrade[]): FanTradeSummary {
  const byExitReason: Partial<Record<FanTradeExitReason, number>> = {};
  if (!trades.length) {
    return { count: 0, winRate: 0, avgReturnPct: 0, medianReturnPct: 0, avgR: 0, medianR: 0, hitTargetPct: 0, avgBarsHeld: 0, byExitReason };
  }
  const rets = trades.map((t) => t.returnPct);
  const rs = trades.map((t) => t.realizedR);
  const n = trades.length;
  for (const t of trades) byExitReason[t.exitReason] = (byExitReason[t.exitReason] ?? 0) + 1;
  return {
    count: n,
    winRate: (rets.filter((r) => r > 0).length / n) * 100,
    avgReturnPct: rets.reduce((a, b) => a + b, 0) / n,
    medianReturnPct: median(rets),
    avgR: rs.reduce((a, b) => a + b, 0) / n,
    medianR: median(rs),
    hitTargetPct: (trades.filter((t) => t.exitReason === 'target_r' || t.exitReason === 'target_window').length / n) * 100,
    avgBarsHeld: trades.reduce((a, t) => a + t.barsHeld, 0) / n,
    byExitReason,
  };
}

const MAX_ACCOUNT_FILLS = 200;

export function addCalendarMonths(iso: string, months: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, Number(m[3])));
  return dt.toISOString().slice(0, 10);
}

export function emptyFanAccountResult(
  startCash = 10_000,
  windowStart: string | null = null,
  windowEnd: string | null = null,
): FanAccountResult {
  return {
    startCash,
    endEquity: startCash,
    returnPct: 0,
    maxDrawdownPct: 0,
    taken: 0,
    skipped: { total: 0, noCash: 0, maxPositions: 0 },
    endReason: 'window',
    windowStart,
    windowEnd,
    candidates: 0,
    curve: windowStart ? [{ date: windowStart, equity: startCash }] : [],
    fills: [],
  };
}

function accountCash(config: FanBacktestConfig): number {
  const n = config.startCash;
  return typeof n === 'number' && n > 0 ? n : 10_000;
}

function accountRiskPct(config: FanBacktestConfig): number {
  const n = config.riskPct;
  return typeof n === 'number' && n > 0 ? Math.min(n, 100) : 1;
}

function accountMaxPositions(config: FanBacktestConfig): number {
  const n = config.maxPositions;
  return typeof n === 'number' && n >= 1 ? Math.min(Math.floor(n), 50) : 4;
}

function accountWindowMonths(config: FanBacktestConfig): number {
  const n = config.windowMonths;
  return typeof n === 'number' && n >= 0 ? Math.floor(n) : 3;
}

function lastDateOf(subjects: FanBacktestSubject[]): string | null {
  let max: string | null = null;
  for (const s of subjects) {
    const d = s.dates?.[s.dates.length - 1];
    if (d && (!max || d > max)) max = d;
  }
  return max;
}

interface OpenPos {
  event: FanEntryEvent;
  shares: number;
  cost: number;
  exitDate: string;
}

function markPeak(equity: number, peak: number, maxDD: number): { peak: number; maxDD: number } {
  const nextPeak = Math.max(peak, equity);
  const dd = nextPeak > 0 ? ((nextPeak - equity) / nextPeak) * 100 : 0;
  return { peak: nextPeak, maxDD: Math.max(maxDD, dd) };
}

/**
 * Replay dated strategy fills as a cash book: last N months (or until ruin),
 * 1R sizing, capped concurrent names. Exits settle before same-day entries.
 */
export function simulateFanAccount(
  entries: FanEntryEvent[],
  config: FanBacktestConfig = DEFAULT_FAN_BACKTEST_CONFIG,
  dataEndDate?: string | null,
): FanAccountResult {
  const startCash = accountCash(config);
  const riskPct = accountRiskPct(config);
  const maxPositions = accountMaxPositions(config);
  const windowMonths = accountWindowMonths(config);

  const dated = entries.filter((e) => e.date && e.trade && e.trade.exitDate && e.trade.exitDate >= e.date);
  const windowEnd = dataEndDate ?? dated.reduce((m, e) => (!m || e.date! > m ? e.date! : m), null as string | null);
  const windowStart = windowEnd && windowMonths > 0 ? addCalendarMonths(windowEnd, -windowMonths) : dated.length ? dated.reduce((m, e) => (e.date! < m ? e.date! : m), dated[0].date!) : null;

  if (!windowStart || !windowEnd) return emptyFanAccountResult(startCash, windowStart, windowEnd);

  const candidates = dated
    .filter((e) => e.date! >= windowStart && e.date! <= windowEnd)
    .sort((a, b) => a.date!.localeCompare(b.date!) || a.ticker.localeCompare(b.ticker));

  let cash = startCash;
  let peak = startCash;
  let maxDD = 0;
  // Held in an object: the only write happens inside closeDue(), and TypeScript
  // does not track closure writes when narrowing a plain `let`.
  const run: { endReason: FanAccountEndReason } = { endReason: 'window' };
  const open = new Map<string, OpenPos>();
  const fills: FanAccountFill[] = [];
  const curve: FanAccountCurvePoint[] = [{ date: windowStart, equity: startCash }];
  const skipped = { total: 0, noCash: 0, maxPositions: 0 };
  let taken = 0;

  const equityOf = () => cash + [...open.values()].reduce((s, p) => s + p.cost, 0);

  const closeDue = (limitDate: string) => {
    const due = [...open.entries()]
      .filter(([, p]) => p.exitDate <= limitDate)
      .sort((a, b) => a[1].exitDate.localeCompare(b[1].exitDate) || a[0].localeCompare(b[0]));
    for (const [ticker, pos] of due) {
      const t = pos.event.trade!;
      const pnl = pos.shares * (t.exitPrice - pos.event.entryPrice);
      cash += pos.shares * t.exitPrice;
      open.delete(ticker);
      const equity = equityOf();
      const marked = markPeak(equity, peak, maxDD);
      peak = marked.peak;
      maxDD = marked.maxDD;
      taken += 1;
      if (fills.length < MAX_ACCOUNT_FILLS) {
        fills.push({ shares: pos.shares, pnl, equityAfter: equity, event: pos.event });
      }
      curve.push({ date: pos.exitDate, equity });
      if (equity <= 0 && open.size === 0) {
        run.endReason = 'ruin';
        return;
      }
    }
  };

  for (const e of candidates) {
    closeDue(e.date!);
    if (run.endReason === 'ruin') break;
    if (open.has(e.ticker)) continue;

    if (open.size >= maxPositions) {
      skipped.maxPositions += 1;
      skipped.total += 1;
      continue;
    }

    const rSize = e.entryPrice - e.trade!.stopPrice;
    if (!(rSize > 0)) {
      skipped.noCash += 1;
      skipped.total += 1;
      continue;
    }
    const equity = equityOf();
    let shares = Math.floor((equity * (riskPct / 100)) / rSize);
    if (shares * e.entryPrice > cash) shares = Math.floor(cash / e.entryPrice);
    if (shares < 1) {
      skipped.noCash += 1;
      skipped.total += 1;
      continue;
    }

    cash -= shares * e.entryPrice;
    open.set(e.ticker, { event: e, shares, cost: shares * e.entryPrice, exitDate: e.trade!.exitDate! });
  }

  if (run.endReason !== 'ruin') closeDue('9999-12-31');

  const endEquity = equityOf();
  return {
    startCash,
    endEquity,
    returnPct: startCash > 0 ? ((endEquity - startCash) / startCash) * 100 : 0,
    maxDrawdownPct: maxDD,
    taken,
    skipped,
    endReason: run.endReason,
    windowStart,
    windowEnd,
    candidates: candidates.length,
    curve,
    fills,
  };
}

export function backtestFanUniverse(
  subjects: FanBacktestSubject[],
  config: FanBacktestConfig = DEFAULT_FAN_BACKTEST_CONFIG,
  onProgress?: (p: FanBacktestProgress) => void,
  maxEntries = 300,
): FanBacktestResult {
  const horizonBuckets: Record<number, number[]> = {};
  for (const h of config.horizons) horizonBuckets[h] = [];
  const allEntries: FanEntryEvent[] = [];
  const allTrades: FanSimulatedTrade[] = [];
  const tickersWithEntries = new Set<string>();

  let stocksScanned = 0;
  for (let si = 0; si < subjects.length; si++) {
    if (!passesFanUniverseFilters(subjects[si], config)) {
      onProgress?.({ name: si + 1, total: subjects.length });
      continue;
    }
    stocksScanned += 1;
    const entries = findFanEntries(subjects[si], config);
    if (entries.length) tickersWithEntries.add(subjects[si].ticker);
    for (const e of entries) {
      allEntries.push(e);
      for (const h of config.horizons) {
        const r = e.forwardReturns[h];
        if (Number.isFinite(r)) horizonBuckets[h].push(r);
      }
      if (e.trade) allTrades.push(e.trade);
    }
    onProgress?.({ name: si + 1, total: subjects.length });
  }

  allEntries.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.ticker.localeCompare(b.ticker));

  return {
    config,
    universe: subjects.length,
    stocksScanned,
    totalEntries: allEntries.length,
    stocksWithEntries: tickersWithEntries.size,
    forwardHorizons: config.horizons.map((h) => ({ h, ...statHorizon(horizonBuckets[h]) })),
    trades: summarizeTrades(allTrades),
    entries: allEntries.slice(0, maxEntries),
    factors: correlateFanFactors(allEntries),
    account: simulateFanAccount(allEntries, config, lastDateOf(subjects)),
  };
}

export function subjectFromStock(s: {
  ticker: string;
  name: string;
  avgVol20?: number;
  marketCap?: number | null;
  full: { o?: number[]; h?: number[]; l?: number[]; c: number[]; d?: string[]; v?: number[] };
}): FanBacktestSubject {
  return {
    ticker: s.ticker,
    name: s.name,
    closes: s.full.c,
    opens: s.full.o,
    highs: s.full.h,
    lows: s.full.l,
    dates: s.full.d,
    volumes: s.full.v,
    avgVol20: s.avgVol20,
    marketCap: s.marketCap ?? null,
  };
}

const EXIT_STORY: Record<FanTradeExitReason, { title: string; body: string }> = {
  stop_r: {
    title: 'Stopped at the structural stop',
    body: 'The bar’s low tagged the initial stop (pullback low / 50-EMA, minus the ATR pad) before price reached 1R. The bounce thesis was invalidated and the loss is capped at about 1R.',
  },
  target_r: {
    title: 'Hard R target tagged',
    body: 'The high reached the configured R multiple. This exit only fires when the trade is not trailing an EMA.',
  },
  target_window: {
    title: 'Entered the 2.5–3R window',
    body: 'The high tagged 2.5R, the floor of the mechanical target window. The trade is not trailing — that is the course exit.',
  },
  breakeven: {
    title: 'Scratched at breakeven',
    body: 'Price first reached 1R, so the stop was moved to entry. A later pullback tagged that stop. No loss, but the winner was not allowed to run.',
  },
  trail: {
    title: 'Trailed out under the 50-EMA',
    body: 'After 1R the stop followed the 50-EMA. A close-enough pullback through that moving average ended the trade and harvested the open profit.',
  },
  pivot_trail: {
    title: 'Trailed out under a pivot low',
    body: 'After entry the stop ratcheted 2¢ under each newly confirmed pivot low. A later bar tagged that trailing stop.',
  },
  macd_window: {
    title: '18–50 MACD flipped',
    body: 'The 18–50 MACD line crossed below its signal. That is used as an exit only when the trade is not trailing — trailing trades ignore this flip.',
  },
  slow_fan_break: {
    title: 'Slow fan broke',
    body: 'EMA 50 > 100 > 200 failed. The higher-timeframe stack that justified holding the pullback is gone, so the engine flattened.',
  },
  fan_break: {
    title: 'Full fan broke',
    body: 'The 18 > 50 > 100 > 200 stack failed. Onset trades treat that as the end of the setup.',
  },
  max_hold: {
    title: 'Max hold reached',
    body: 'The trade hit the bar limit without tagging the stop, trail, or target. The exit is the close on that bar, not a structural event.',
  },
  end_of_data: {
    title: 'Still open at the last bar',
    body: 'The dataset ended while this trade was open. The R shown is mark-to-market on the final close, not a rule-based exit — treat large figures here as unfinished, not as realized P/L.',
  },
};

const ENTRY_STORY: Record<FanStrategyId, string> = {
  onset: 'First bar the full 18 > 50 > 100 > 200 stack appeared.',
  cross: '18 crossed up through 50 while 50 > 100 > 200 still held.',
  tag18: 'Pullback tagged the 18-EMA (bone zone) and closed back above it, 0–2 lower lows, 50 still rising.',
  tag50: 'Pullback tagged the 50-EMA and closed back above it, 0–2 lower lows, 50 still rising, while 18 > 50 > 100 > 200 held.',
  structure: '50-EMA tag plus a 2-bar reversal or rejection wick, with 18–50 MACD still favorable if that filter was on.',
  dual_ema: 'Same structure as a 50-tag, but the bar also traded up through the 18.',
  bunn_bounce: 'Reversal bar bounced on the 50, 100, or 200 while 50 > 100 > 200 held. Filled at a buy stop 2¢ above that bar; initial stop is the bar height plus 2¢.',
  bunn_cont: '18 adversely crossed 50, price reversed on the 100 or 200, then the full fan resumed. Filled at a buy stop 2¢ above the resume bar; initial stop is 2¢ below that bounce low.',
};

export interface FanTradeStory {
  headline: string;
  entry: string;
  exit: string;
  excursion: string | null;
}

export function explainFanTrade(event: FanEntryEvent): FanTradeStory {
  const t = event.trade;
  const when = event.date ?? 'this bar';
  const fill = event.strategy === 'bunn_bounce' || event.strategy === 'bunn_cont'
    ? `Filled a buy stop on ${when} at ${event.entryPrice.toFixed(2)}.`
    : `Bought the close on ${when} at ${event.entryPrice.toFixed(2)}.`;
  let entry = `${fill} ${ENTRY_STORY[event.strategy]}`;
  if (event.strategy !== 'bunn_bounce' && event.strategy !== 'bunn_cont' && event.fanBar < event.barIndex) {
    const n = event.barIndex - event.fanBar;
    entry += ` Fan first stacked ${n} bar${n === 1 ? '' : 's'} earlier.`;
  }
  if (!t) {
    return {
      headline: 'Signal without a simulated trade',
      entry,
      exit: 'No fill was simulated — the stop was too tight relative to price, or the bar was unusable.',
      excursion: null,
    };
  }
  const r = `${t.realizedR >= 0 ? '+' : ''}${t.realizedR.toFixed(2)}R`;
  const story = EXIT_STORY[t.exitReason];
  const excursion = `Held ${t.barsHeld} bar${t.barsHeld === 1 ? '' : 's'}. Best excursion ${t.maxFavorablePct >= 0 ? '+' : ''}${t.maxFavorablePct.toFixed(2)}%, worst ${t.maxAdversePct.toFixed(2)}%.`;
  return {
    headline: `${story.title} (${r})`,
    entry,
    exit: story.body,
    excursion,
  };
}

/** Slice of history to draw around a trade. `extra` bars (fan/impulse) expand the window. */
export function tradeChartRange(
  entryBar: number,
  exitBar: number,
  n: number,
  before = 80,
  after = 20,
  extra: number[] = [],
): { from: number; to: number } {
  if (n < 1) return { from: 0, to: 0 };
  const left = Math.min(entryBar - before, ...extra.map((b) => b - 8));
  const right = Math.max(Math.max(entryBar, exitBar) + after, ...extra.map((b) => b + 2));
  const from = Math.max(0, left);
  const to = Math.min(n - 1, right);
  return { from, to: Math.max(from, to) };
}

export function fanEntryIndex(entries: FanEntryEvent[], event: FanEntryEvent): number {
  return entries.findIndex((e) => e.ticker === event.ticker && e.barIndex === event.barIndex && e.date === event.date);
}
