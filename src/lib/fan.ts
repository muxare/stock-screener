// fan.ts — EMA-fan classifier.
//
//   match: ema18 > ema50 > ema100 > ema200 on the last bar
//   near:  not a match, within 0.5% of stacking, and the worst gap is
//          improving vs FAN_ENTER_LOOKBACK bars ago (entering, not exiting)
//   none:  otherwise

import { ema, sma } from './indicators.ts';
import { buildSnapshot, type IndicatorSnapshot } from './screen/snapshot.ts';

export const FAN_PERIODS = [18, 50, 100, 200] as const;
/** Relative inversion allowed on the worst adjacent pair to count as "close". */
export const FAN_NEAR_MARGIN = 0.005;
/** Bars back used to tell entering the fan from leaving it. */
export const FAN_ENTER_LOOKBACK = 10;
/**
 * Trading-day lookbacks for “200-EMA has been rising a while.”
 * 21 ≈ 1 month (usual minimum), 63 ≈ 3 months, 105 ≈ 5 months (stricter).
 */
export const EMA200_RISING_LOOKBACKS = [21, 63, 105] as const;
export type Ema200RisingLookback = (typeof EMA200_RISING_LOOKBACKS)[number];
export type Ema200Ago = Record<Ema200RisingLookback, number | null>;

export type FanStatus = 'match' | 'near' | 'none';

export interface FanEmas {
  ema18: number;
  ema50: number;
  ema100: number;
  ema200: number;
}

export interface FanGaps {
  ema18v50: number;
  ema50v100: number;
  ema100v200: number;
}

export interface FanClassification {
  status: FanStatus;
  emas: FanEmas;
  gaps: FanGaps;
  /** Smallest adjacent gap as a fraction of the slower EMA. Match ⇒ all > 0. */
  worstGap: number;
}

export interface FanSubject {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  sparkline: number[];
  /** Highs and lows are optional: without them the snapshot's ATR% is NaN. */
  full: { c: number[]; v?: number[]; h?: number[]; l?: number[] };
  avgVol20?: number;
  relVol?: number;
  marketCap?: number | null;
}

export interface FanRow {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  ema18: number;
  ema50: number;
  ema100: number;
  ema200: number;
  /** 200-EMA value 21 / 63 / 105 bars ago. null when history is too short. */
  ema200Ago: Ema200Ago;
  worstGap: number;
  sparkline: number[];
  avgVol20: number;
  relVol: number;
  marketCap: number | null;
  /** Last-bar RSI / Stoch RSI / volatility / performance, for columns and filters. */
  snapshot: IndicatorSnapshot;
}

function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

/** True when the 200-EMA at `i` is above its value `lookback` bars ago. 0 = no filter. */
export function ema200RisingAt(e200: number[], i: number, lookback: number): boolean {
  if (!(lookback > 0)) return true;
  if (i < lookback) return false;
  const now = e200[i];
  const then = e200[i - lookback];
  return Number.isFinite(now) && Number.isFinite(then) && now > then;
}

export function ema200AgoOf(e200: number[], i: number = e200.length - 1): Ema200Ago {
  const ago = { 21: null, 63: null, 105: null } as Ema200Ago;
  for (const n of EMA200_RISING_LOOKBACKS) {
    const then = e200[i - n];
    ago[n] = i >= n && Number.isFinite(then) ? then : null;
  }
  return ago;
}

function pairGap(faster: number, slower: number): number | null {
  if (!Number.isFinite(faster) || !Number.isFinite(slower) || slower === 0) return null;
  return (faster - slower) / Math.abs(slower);
}

export function fanEmasFromCloses(closes: number[]): FanEmas | null {
  if (!closes.length) return null;
  const emas: FanEmas = {
    ema18: last(ema(closes, 18)),
    ema50: last(ema(closes, 50)),
    ema100: last(ema(closes, 100)),
    ema200: last(ema(closes, 200)),
  };
  if (![emas.ema18, emas.ema50, emas.ema100, emas.ema200].every(Number.isFinite)) return null;
  return emas;
}

function emasAt(e18: number[], e50: number[], e100: number[], e200: number[], i: number): FanEmas {
  return { ema18: e18[i], ema50: e50[i], ema100: e100[i], ema200: e200[i] };
}

/** Latest-bar geometry only: stacked / within margin / far. No lookback. */
export function classifyFan(emas: FanEmas, margin: number = FAN_NEAR_MARGIN): FanClassification {
  const ema18v50 = pairGap(emas.ema18, emas.ema50);
  const ema50v100 = pairGap(emas.ema50, emas.ema100);
  const ema100v200 = pairGap(emas.ema100, emas.ema200);
  const gaps: FanGaps = {
    ema18v50: ema18v50 ?? NaN,
    ema50v100: ema50v100 ?? NaN,
    ema100v200: ema100v200 ?? NaN,
  };
  if (ema18v50 == null || ema50v100 == null || ema100v200 == null) {
    return { status: 'none', emas, gaps, worstGap: NaN };
  }
  const worstGap = Math.min(ema18v50, ema50v100, ema100v200);
  const match = ema18v50 > 0 && ema50v100 > 0 && ema100v200 > 0;
  const status: FanStatus = match ? 'match' : worstGap >= -margin ? 'near' : 'none';
  return { status, emas, gaps, worstGap };
}

/**
 * Classify at bar index `i` (inclusive prefix). Same rules as classifyFanSeries
 * on the last bar of the prefix.
 */
export function classifyFanAtIndex(
  e18: number[],
  e50: number[],
  e100: number[],
  e200: number[],
  i: number,
  margin: number = FAN_NEAR_MARGIN,
  lookback: number = FAN_ENTER_LOOKBACK,
): FanClassification {
  const n = i + 1;
  const empty: FanEmas = { ema18: NaN, ema50: NaN, ema100: NaN, ema200: NaN };
  if (n < 1 || i < 0 || e50.length < n || e100.length < n || e200.length < n) {
    return { status: 'none', emas: empty, gaps: { ema18v50: NaN, ema50v100: NaN, ema100v200: NaN }, worstGap: NaN };
  }
  const now = classifyFan(emasAt(e18, e50, e100, e200, i), margin);
  if (now.status === 'match') return now;
  if (now.status !== 'near') return now;
  if (n <= lookback) return { ...now, status: 'none' };
  const then = classifyFan(emasAt(e18, e50, e100, e200, i - lookback), margin);
  if (!Number.isFinite(then.worstGap) || !(now.worstGap > then.worstGap)) {
    return { ...now, status: 'none' };
  }
  return now;
}

/**
 * Product classifier over EMA series. Near means close to *entering* a fan:
 * currently not stacked, within the margin, and the worst gap is better than
 * it was `lookback` bars ago.
 */
export function classifyFanSeries(
  e18: number[],
  e50: number[],
  e100: number[],
  e200: number[],
  margin: number = FAN_NEAR_MARGIN,
  lookback: number = FAN_ENTER_LOOKBACK,
): FanClassification {
  const n = e18.length;
  const empty: FanEmas = { ema18: NaN, ema50: NaN, ema100: NaN, ema200: NaN };
  if (n < 1 || e50.length !== n || e100.length !== n || e200.length !== n) {
    return { status: 'none', emas: empty, gaps: { ema18v50: NaN, ema50v100: NaN, ema100v200: NaN }, worstGap: NaN };
  }
  const now = classifyFan(emasAt(e18, e50, e100, e200, n - 1), margin);
  if (now.status === 'match') return now;
  if (now.status !== 'near') return now;
  if (n <= lookback) return { ...now, status: 'none' };
  const then = classifyFan(emasAt(e18, e50, e100, e200, n - 1 - lookback), margin);
  if (!Number.isFinite(then.worstGap) || !(now.worstGap > then.worstGap)) {
    return { ...now, status: 'none' };
  }
  return now;
}

export function classifyCloses(
  closes: number[],
  margin: number = FAN_NEAR_MARGIN,
  lookback: number = FAN_ENTER_LOOKBACK,
): FanClassification {
  if (!closes.length) {
    return classifyFanSeries([], [], [], [], margin, lookback);
  }
  return classifyFanSeries(
    ema(closes, 18),
    ema(closes, 50),
    ema(closes, 100),
    ema(closes, 200),
    margin,
    lookback,
  );
}

function liquidityFromSubject(s: FanSubject): Pick<FanRow, 'avgVol20' | 'relVol' | 'marketCap'> {
  if (s.avgVol20 != null && s.relVol != null) {
    return { avgVol20: s.avgVol20, relVol: s.relVol, marketCap: s.marketCap ?? null };
  }
  const vols = s.full.v ?? [];
  const avgArr = vols.length ? sma(vols, 20) : [];
  const avgVol20 = avgArr.length ? avgArr[avgArr.length - 1] ?? 0 : 0;
  const lastVol = vols.length ? vols[vols.length - 1] : 0;
  const relVol = avgVol20 > 0 ? lastVol / avgVol20 : 1;
  return { avgVol20, relVol, marketCap: s.marketCap ?? null };
}

function toRow(s: FanSubject, c: FanClassification, e200: number[]): FanRow {
  return {
    ticker: s.ticker,
    name: s.name,
    sector: s.sector,
    price: s.price,
    changePct: s.changePct,
    ema18: c.emas.ema18,
    ema50: c.emas.ema50,
    ema100: c.emas.ema100,
    ema200: c.emas.ema200,
    ema200Ago: ema200AgoOf(e200),
    worstGap: c.worstGap,
    sparkline: s.sparkline,
    snapshot: buildSnapshot({
      closes: s.full.c,
      volumes: s.full.v,
      highs: s.full.h,
      lows: s.full.l,
    }),
    ...liquidityFromSubject(s),
  };
}

function byGapThenTicker(a: FanRow, b: FanRow): number {
  const g = b.worstGap - a.worstGap;
  return g !== 0 ? g : a.ticker.localeCompare(b.ticker);
}

export function screenFan(
  subjects: FanSubject[],
  margin: number = FAN_NEAR_MARGIN,
): { matches: FanRow[]; near: FanRow[] } {
  const matches: FanRow[] = [];
  const near: FanRow[] = [];
  for (const s of subjects) {
    const closes = s.full.c;
    if (!closes.length) continue;
    const e18 = ema(closes, 18);
    const e50 = ema(closes, 50);
    const e100 = ema(closes, 100);
    const e200 = ema(closes, 200);
    const c = classifyFanSeries(e18, e50, e100, e200, margin);
    if (c.status === 'none') continue;
    const row = toRow(s, c, e200);
    if (c.status === 'match') matches.push(row);
    else near.push(row);
  }
  matches.sort(byGapThenTicker);
  near.sort(byGapThenTicker);
  return { matches, near };
}
