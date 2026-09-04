// fanSignals.ts — live "current entry" screen.
//
// Reuses the fan-strategy detector (fanBacktest.findFanEntries) and surfaces the
// ONE entry per name whose simulated trade is still open on the latest bar —
// i.e. it entered and has not yet tagged the stop or the target. That is a
// live, actionable setup: entry price, 1R stop, and a 2.5–3R exit window.
//
// The scan runs a deliberately un-managed trade (hard 3R target, no trail/
// breakeven, no max hold) so "open" means exactly "price is still between the
// initial stop and the target while the fan holds" — nothing fancier.

import {
  findFanEntries,
  passesFanUniverseFilters,
  BUNN_WINDOW_LO,
  BUNN_WINDOW_HI,
  DEFAULT_FAN_BACKTEST_CONFIG,
  FAN_STRATEGIES,
  type FanBacktestConfig,
  type FanBacktestSubject,
  type FanEntryEvent,
  type FanStrategyId,
} from './fanBacktest.ts';

/** Displayed exit window, in R multiples of the initial risk. */
export const SIGNAL_TARGET_LO_R = BUNN_WINDOW_LO; // 2.5
export const SIGNAL_TARGET_HI_R = BUNN_WINDOW_HI; // 3

/** A backtest subject plus the fields the screener rows/filters need. */
export interface FanSignalSubject extends FanBacktestSubject {
  sector: string;
  price: number;
  changePct: number;
  sparkline?: number[];
}

export interface FanSignalRow {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  strategy: FanStrategyId;
  /** Calendar date of the entry bar when the subject carries dates. */
  entryDate: string | null;
  /** Bars between the entry and the latest bar (0 = entered on the last bar). */
  barsAgo: number;
  entryPrice: number;
  stopPrice: number;
  /** Initial risk per share (entry − stop) = 1R, in price. */
  riskPerShare: number;
  /** Risk as a percent of the entry price. */
  riskPct: number;
  targetLoR: number;
  targetHiR: number;
  targetLoPrice: number;
  targetHiPrice: number;
  /** Mark-to-market R at the latest close (the trade is still open). */
  openR: number;
  avgVol20: number;
  marketCap: number | null;
  sparkline: number[];
}

/** Human label for a strategy id (falls back to the id when unknown). */
export function strategyLabel(id: FanStrategyId): string {
  return FAN_STRATEGIES.find((s) => s.id === id)?.label ?? id;
}

/**
 * Build the scan config for the live-entry screen: the chosen strategy, the
 * universe filters carried from the main filter bar (volume / cap / 200-EMA
 * slope), and a fixed, un-managed 3R trade so "open" is unambiguous.
 */
export function signalScanConfig(
  strategy: FanStrategyId,
  filters: Pick<FanBacktestConfig, 'minAvgVol' | 'minMarketCap' | 'ema200RisingBars'> = {},
): FanBacktestConfig {
  return {
    ...DEFAULT_FAN_BACKTEST_CONFIG,
    strategy,
    entry: 'match',
    targetR: SIGNAL_TARGET_HI_R,
    targetWindow: false,
    trailEma: null,
    trailPivot: false,
    breakevenAtR: null,
    macdWindow: false,
    maxHoldBars: null,
    minAvgVol: filters.minAvgVol ?? 0,
    minMarketCap: filters.minMarketCap ?? 0,
    ema200RisingBars: filters.ema200RisingBars ?? DEFAULT_FAN_BACKTEST_CONFIG.ema200RisingBars,
  };
}

/** The most recent still-open entry for a name, or null. */
export function currentOpenEntry(entries: FanEntryEvent[]): FanEntryEvent | null {
  let open: FanEntryEvent | null = null;
  for (const e of entries) {
    if (e.trade && e.trade.exitReason === 'end_of_data') open = e;
  }
  return open;
}

export function signalRowFromEntry(
  s: FanSignalSubject,
  e: FanEntryEvent,
  seriesLength: number,
): FanSignalRow | null {
  const t = e.trade;
  if (!t) return null;
  const entryPrice = e.entryPrice;
  const stopPrice = t.stopPrice;
  const riskPerShare = entryPrice - stopPrice;
  if (!(riskPerShare > 0) || !(entryPrice > 0)) return null;
  return {
    ticker: s.ticker,
    name: s.name,
    sector: s.sector,
    price: s.price,
    changePct: s.changePct,
    strategy: e.strategy,
    entryDate: e.date,
    barsAgo: Math.max(0, seriesLength - 1 - e.barIndex),
    entryPrice,
    stopPrice,
    riskPerShare,
    riskPct: (riskPerShare / entryPrice) * 100,
    targetLoR: SIGNAL_TARGET_LO_R,
    targetHiR: SIGNAL_TARGET_HI_R,
    targetLoPrice: entryPrice + SIGNAL_TARGET_LO_R * riskPerShare,
    targetHiPrice: entryPrice + SIGNAL_TARGET_HI_R * riskPerShare,
    openR: t.realizedR,
    avgVol20: s.avgVol20 ?? 0,
    marketCap: s.marketCap ?? null,
    sparkline: s.sparkline ?? [],
  };
}

/** Freshest first (fewest bars since entry), then ticker. */
function byFreshnessThenTicker(a: FanSignalRow, b: FanSignalRow): number {
  return a.barsAgo - b.barsAgo || a.ticker.localeCompare(b.ticker);
}

/**
 * Scan a universe for names with a live open entry under `config.strategy`.
 * Volume / cap floors are applied here; the 200-EMA slope is enforced by the
 * detector at the fill (config.ema200RisingBars).
 */
export function screenFanSignals(
  subjects: FanSignalSubject[],
  config: FanBacktestConfig,
): FanSignalRow[] {
  const out: FanSignalRow[] = [];
  for (const s of subjects) {
    if (!passesFanUniverseFilters(s, config)) continue;
    const open = currentOpenEntry(findFanEntries(s, config));
    if (!open) continue;
    const row = signalRowFromEntry(s, open, s.closes.length);
    if (row) out.push(row);
  }
  out.sort(byFreshnessThenTicker);
  return out;
}

/** Compact exit-window label, e.g. "148.20–151.00 (2.5–3R)". */
export function fmtTargetWindow(row: FanSignalRow): string {
  const r = row.targetLoR === row.targetHiR
    ? `${row.targetHiR}R`
    : `${row.targetLoR}–${row.targetHiR}R`;
  return `${row.targetLoPrice.toFixed(2)}–${row.targetHiPrice.toFixed(2)} (${r})`;
}

/** Client-side facets the detector does not apply: sector, min price, search. */
export function filterSignalRows(
  rows: FanSignalRow[],
  search: string,
  sector: string,
  minPrice: number,
): FanSignalRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (sector && r.sector !== sector) return false;
    if (minPrice > 0 && (!Number.isFinite(r.price) || r.price < minPrice)) return false;
    if (q && !r.ticker.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
    return true;
  });
}
