// screen/snapshot.ts — the per-name indicator snapshot the screener tables and
// (from phase 2) the filter chips read.
//
// One flat record of last-bar numbers computed from the OHLCV the subject
// already holds, so the fan screen and the entry scan can show and sort on RSI,
// Stoch RSI, volatility and performance without a second server round trip.
// The math itself is `indicators.ts` — this module only picks the last value
// and decides when the history is too short to have one.
//
// Convention: **NaN means "not computable here"**, never 0 and never a
// placeholder. Sorting and formatting both treat NaN as missing, so a name with
// 30 bars of history sorts last on RSI instead of pretending to be neutral.
// JSON has no NaN, so a snapshot that crosses /screen arrives with those slots
// as `null`: read them through the field registry (`fields.ts`), which maps
// both to "missing", rather than testing for NaN yourself.
// Percent-shaped fields (`perf1m`, `perf3m`, `atrPct`) are *fractions*
// (0.025 = +2.5%); `changePct` on the rows themselves is not — see fields.ts.

import { atr14, rsi, stochRsi } from '../indicators.ts';

/** Trading days in the perf / 52-week lookbacks. */
export const PERF_1M_BARS = 21;
export const PERF_3M_BARS = 63;
export const WEEK52_BARS = 252;
export const RSI_PERIOD = 14;

export interface IndicatorSnapshot {
  /** Volume on the last bar. */
  volume: number;
  rsi14: number;
  /** stochRsi(14, 14, 3, 3) %K, 0–100. */
  stochK: number;
  stochD: number;
  /** Fraction: close / close[-21] − 1. */
  perf1m: number;
  /** Fraction: close / close[-63] − 1. */
  perf3m: number;
  /** Fraction: ATR(14) / close — the volatility proxy. */
  atrPct: number;
  /** Highest high / lowest low over the last 252 bars (closes when no H/L). */
  hi52: number;
  lo52: number;
}

export interface SnapshotInput {
  closes: number[];
  volumes?: number[];
  highs?: number[];
  lows?: number[];
}

export const EMPTY_SNAPSHOT: IndicatorSnapshot = {
  volume: NaN,
  rsi14: NaN,
  stochK: NaN,
  stochD: NaN,
  perf1m: NaN,
  perf3m: NaN,
  atrPct: NaN,
  hi52: NaN,
  lo52: NaN,
};

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

/** close / close[-bars] − 1, or NaN when the history is shorter than `bars`. */
function perfOver(closes: number[], bars: number): number {
  const i = closes.length - 1 - bars;
  if (i < 0) return NaN;
  const then = num(closes[i]);
  const now = num(closes[closes.length - 1]);
  if (!Number.isFinite(then) || !Number.isFinite(now) || then === 0) return NaN;
  return now / then - 1;
}

function extremeOver(values: number[] | undefined, bars: number, pick: 'hi' | 'lo'): number {
  if (!values || values.length === 0) return NaN;
  let best = NaN;
  for (let i = Math.max(0, values.length - bars); i < values.length; i++) {
    const v = num(values[i]);
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(best) || (pick === 'hi' ? v > best : v < best)) best = v;
  }
  return best;
}

/**
 * Last-bar snapshot for one name. Everything that cannot be computed from the
 * bars given (no volume column, no highs/lows for ATR, too little history for
 * RSI or a 3-month performance) comes back NaN.
 */
export function buildSnapshot({ closes, volumes, highs, lows }: SnapshotInput): IndicatorSnapshot {
  if (!closes || closes.length === 0) return { ...EMPTY_SNAPSHOT };
  const n = closes.length - 1;
  const close = num(closes[n]);

  // rsi() backfills the warm-up bars with its first computed value and returns
  // a flat 50 for a series shorter than the period; neither is a real reading.
  const rsiArr = closes.length > RSI_PERIOD ? rsi(closes, RSI_PERIOD) : null;
  // The stochastic ranks RSI inside its own 14-bar window, so it needs a window
  // of RSI values that are all real — twice the period. Earlier than that the
  // window is mostly backfilled copies of one number and %K collapses to 0.
  const stoch = rsiArr && closes.length > RSI_PERIOD * 2
    ? stochRsi(rsiArr, RSI_PERIOD, 3, 3)
    : null;

  const hasBands = !!highs && !!lows && highs.length === closes.length && lows.length === closes.length;
  const atr = hasBands ? num(atr14(highs, lows, closes)[n]) : NaN;

  return {
    volume: volumes && volumes.length === closes.length ? num(volumes[n]) : NaN,
    rsi14: rsiArr ? num(rsiArr[n]) : NaN,
    stochK: stoch ? num(stoch.k[n]) : NaN,
    stochD: stoch ? num(stoch.d[n]) : NaN,
    perf1m: perfOver(closes, PERF_1M_BARS),
    perf3m: perfOver(closes, PERF_3M_BARS),
    atrPct: Number.isFinite(atr) && Number.isFinite(close) && close !== 0 ? atr / close : NaN,
    hi52: extremeOver(hasBands ? highs : closes, WEEK52_BARS, 'hi'),
    lo52: extremeOver(hasBands ? lows : closes, WEEK52_BARS, 'lo'),
  };
}
