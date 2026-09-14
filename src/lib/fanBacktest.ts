// fanBacktest.ts — fan-strategy backtest: universe scan, trade statistics,
// swing-account replay and trade stories.
//
// Entry detection lives in strategy/engine.ts: a strategy is a StrategyDef (an
// ordered state machine of steps plus entry / stop / exit rows, see
// strategy/types.ts). The eight former fixed strategies are presets built from
// those steps (strategy/presets.ts). This module keeps the parts that do not
// depend on how an entry was found — filters, aggregation, the cash book, and
// the exit narratives — and re-exports the primitives and the trade simulator
// so older imports keep resolving.
//
// Swing account: last N months of the fills, sized at risk% of equity / 1R,
// capped concurrent names, until the window ends or equity hits zero.
// Illustrative only — no costs, slippage, or gap handling.

import type { HorizonStat } from './market.ts';
import { findStrategyEntries } from './strategy/engine.ts';
import { presetById } from './strategy/presets.ts';
import type { FanEntryIndicators } from './strategy/primitives.ts';
import type { FanSimulatedTrade, FanTradeExitReason } from './strategy/trade.ts';
import type { StrategyDef, StrategyMark } from './strategy/types.ts';

export {
  BUNN_PENNY,
  BUNN_WINDOW_LO,
  BUNN_WINDOW_HI,
  EMA_WARM,
  MIN_R_FRAC,
  macd1850,
  slowFanUp,
  fullFanUp,
  crossUp,
  crossDown,
  crossUp18_50,
  crossDown18_50,
  isLongReversal,
  isBunnLongReversal,
  isLongPivotCandidate,
  longPivotConfirmBar,
  lastConfirmedPivotLow,
  isMaBounce,
  atr14,
  slopeUp,
  statusAt,
  macdFav,
  snapshotIndicators,
} from './strategy/primitives.ts';
export type { FanEntryIndicators } from './strategy/primitives.ts';
export { simulateRTrade } from './strategy/trade.ts';
export type { FanSimulatedTrade, FanTradeExitReason } from './strategy/trade.ts';
export { findStrategyEntries, runStrategy } from './strategy/engine.ts';
export type { StrategyDef, StrategyMark, StepKind, Step, EntrySpec, StopSpec, ExitSpec } from './strategy/types.ts';

export interface FanBacktestConfig {
  /** The step machine + trade rows. Presets: strategy/presets.ts. */
  strategy: StrategyDef;
  horizons: number[];
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
  strategy: presetById('tag50'),
  horizons: [5, 10, 20, 40],
  minAvgVol: 0,
  minMarketCap: 0,
  ema200RisingBars: 21,
  startCash: 10_000,
  riskPct: 1,
  maxPositions: 4,
  windowMonths: 3,
};

export interface FanEntryEvent {
  ticker: string;
  name: string;
  date: string | null;
  /** Fill bar. */
  barIndex: number;
  strategyId: string;
  strategyName: string;
  entryMode: 'buy_stop' | 'close';
  /** One-line story of the steps and the entry rule (describeStrategy). */
  summary: string;
  entryPrice: number;
  worstGap: number;
  forwardReturns: Record<number, number>;
  trade: FanSimulatedTrade | null;
  /** One mark per fired step, in step order. */
  marks: StrategyMark[];
  /** First candle/tracker mark — where the setup began. */
  fanBar: number;
  /** Candle/tracker mark with the highest high (swing high). */
  impulseBar: number;
  /** Last candle/tracker mark (the trigger). */
  reactionBar: number;
  /** Classic MACD (12/26/9) + Stoch RSI (14/14/3/3) at the entry bar. */
  indicators: FanEntryIndicators | null;
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

function statHorizon(arr: number[]): Omit<HorizonStat, 'h'> {
  const n = arr.length;
  if (!n) return { n: 0, avg: 0, median: 0, winRate: 0, best: 0, worst: 0 };
  const sorted = arr.slice().sort((a, b) => a - b);
  const avg = arr.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, avg, median, winRate: (arr.filter((x) => x > 0).length / n) * 100, best: sorted[n - 1], worst: sorted[0] };
}

/** Entry events for one subject under `config.strategy`. Alias of findStrategyEntries. */
export function findFanEntries(
  subject: FanBacktestSubject,
  config: FanBacktestConfig = DEFAULT_FAN_BACKTEST_CONFIG,
): FanEntryEvent[] {
  return findStrategyEntries(subject, config);
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
    const entries = findStrategyEntries(subjects[si], config);
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

export interface FanTradeStory {
  headline: string;
  entry: string;
  exit: string;
  excursion: string | null;
}

export function explainFanTrade(event: FanEntryEvent): FanTradeStory {
  const t = event.trade;
  const when = event.date ?? 'this bar';
  const fill = event.entryMode === 'buy_stop'
    ? `Filled a buy stop on ${when} at ${event.entryPrice.toFixed(2)}.`
    : `Bought the close on ${when} at ${event.entryPrice.toFixed(2)}.`;
  let entry = `${fill} Setup: ${event.summary}`;
  if (event.fanBar < event.barIndex) {
    const n = event.barIndex - event.fanBar;
    const first = event.marks.find((m) => m.bar === event.fanBar);
    entry += ` The setup began ${n} bar${n === 1 ? '' : 's'} earlier${first ? ` (${first.label})` : ''}.`;
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

/** Bars before the entry that a mark may still expand the default window to. */
export const TRADE_CHART_MAX_LOOKBACK = 160;

/**
 * Slice of history to draw around a trade. `extra` bars (marks) expand the
 * window, clamped to TRADE_CHART_MAX_LOOKBACK bars before the entry — a held
 * fan step can fire hundreds of bars before the fill.
 */
export function tradeChartRange(
  entryBar: number,
  exitBar: number,
  n: number,
  before = 80,
  after = 20,
  extra: number[] = [],
): { from: number; to: number } {
  if (n < 1) return { from: 0, to: 0 };
  const floor = entryBar - TRADE_CHART_MAX_LOOKBACK;
  const left = Math.min(entryBar - before, ...extra.map((b) => Math.max(floor, b - 8)));
  const right = Math.max(Math.max(entryBar, exitBar) + after, ...extra.map((b) => b + 2));
  const from = Math.max(0, left);
  const to = Math.min(n - 1, right);
  return { from, to: Math.max(from, to) };
}

export function fanEntryIndex(entries: FanEntryEvent[], event: FanEntryEvent): number {
  return entries.findIndex((e) => e.ticker === event.ticker && e.barIndex === event.barIndex && e.date === event.date);
}
