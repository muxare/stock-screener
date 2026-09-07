// strategy/primitives.ts — bar-level predicates and constants shared by the
// step registry, the trade simulator and the engine. Moved verbatim from
// fanBacktest.ts (which re-exports them so existing imports keep resolving).

import { classifyFanAtIndex, type FanStatus } from '../fan.ts';
import { ema } from '../indicators.ts';

/** Course “two pennies” offset for bounce buy-stops and stop wiggle. */
export const BUNN_PENNY = 0.02;
/** Mechanical target-window floor (exit). Cap 3R is unused for fill. */
export const BUNN_WINDOW_LO = 2.5;
export const BUNN_WINDOW_HI = 3;
export const EMA_WARM = 200;
export const MIN_R_FRAC = 0.0015;

export interface FanEntryIndicators {
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  stochK: number;
  stochD: number;
}

export interface MacdSeries { line: number[]; signal: number[]; hist: number[] }

export function macd1850(e18: number[], e50: number[]): MacdSeries {
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
  classic: MacdSeries,
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

/** Fast crosses up through slow on bar i. */
export function crossUp(fast: number[], slow: number[], i: number): boolean {
  return i > 0 && fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
}

export function crossDown(fast: number[], slow: number[], i: number): boolean {
  return i > 0 && fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];
}

export function crossUp18_50(e18: number[], e50: number[], i: number): boolean {
  return crossUp(e18, e50, i);
}

export function crossDown18_50(e18: number[], e50: number[], i: number): boolean {
  return crossDown(e18, e50, i);
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

export function slopeUp(arr: number[], i: number, n = 5): boolean {
  return i >= n && arr[i] > arr[i - n];
}

export function statusAt(e18: number[], e50: number[], e100: number[], e200: number[], i: number): FanStatus {
  return classifyFanAtIndex(e18, e50, e100, e200, i).status;
}

export function macdFav(macd: MacdSeries, i: number): boolean {
  return macd.line[i] > macd.signal[i] && macd.hist[i] >= 0;
}
