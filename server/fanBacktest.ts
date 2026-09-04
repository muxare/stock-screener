// fanBacktest.ts — server wrapper over the fan-entry backtest engine.

import {
  backtestFanUniverse,
  subjectFromStock,
  DEFAULT_FAN_BACKTEST_CONFIG,
  type FanBacktestConfig,
  type FanBacktestProgress,
  type FanBacktestResult,
  type FanStrategyId,
} from '../src/lib/fanBacktest.ts';
import type { Stock } from '../src/lib/market.ts';

export type { FanBacktestConfig, FanBacktestResult, FanBacktestProgress };
export { DEFAULT_FAN_BACKTEST_CONFIG };

const STRATS: FanStrategyId[] = ['onset', 'cross', 'tag18', 'tag50', 'structure', 'dual_ema', 'bunn_bounce', 'bunn_cont'];

export function parseFanBacktestBody(body: unknown): FanBacktestConfig {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const strategy = STRATS.includes(b.strategy as FanStrategyId)
    ? b.strategy as FanStrategyId
    : b.entry === 'near' || b.entry === 'match'
      ? 'onset'
      : DEFAULT_FAN_BACKTEST_CONFIG.strategy;
  const horizons = Array.isArray(b.horizons)
    ? b.horizons.filter((h): h is number => typeof h === 'number' && h > 0)
    : DEFAULT_FAN_BACKTEST_CONFIG.horizons;
  return {
    strategy,
    entry: b.entry === 'near' ? 'near' : 'match',
    targetR: typeof b.targetR === 'number' && b.targetR > 0 ? b.targetR : DEFAULT_FAN_BACKTEST_CONFIG.targetR,
    macdWindow: typeof b.macdWindow === 'boolean' ? b.macdWindow : DEFAULT_FAN_BACKTEST_CONFIG.macdWindow,
    maxHoldBars: b.maxHoldBars === null ? null : typeof b.maxHoldBars === 'number' ? b.maxHoldBars : DEFAULT_FAN_BACKTEST_CONFIG.maxHoldBars,
    horizons: horizons.length ? horizons : DEFAULT_FAN_BACKTEST_CONFIG.horizons,
    continueEpisode: b.continueEpisode === false ? false : true,
    breakevenAtR: b.breakevenAtR === null ? null : typeof b.breakevenAtR === 'number' ? b.breakevenAtR : 1,
    trailEma: b.trailPivot === true
      ? null
      : b.trailEma === 18 || b.trailEma === 50
        ? b.trailEma
        : b.trailEma === null
          ? null
          : DEFAULT_FAN_BACKTEST_CONFIG.trailEma ?? null,
    targetWindow: b.trailPivot === true ? false : b.targetWindow === true,
    trailPivot: b.trailPivot === true,
    stopAtrMult: typeof b.stopAtrMult === 'number' && b.stopAtrMult >= 0 ? b.stopAtrMult : 0.25,
    minAvgVol: typeof b.minAvgVol === 'number' && b.minAvgVol >= 0 ? b.minAvgVol : 0,
    minMarketCap: typeof b.minMarketCap === 'number' && b.minMarketCap >= 0 ? b.minMarketCap : 0,
    ema200RisingBars: typeof b.ema200RisingBars === 'number' && b.ema200RisingBars >= 0
      ? Math.floor(b.ema200RisingBars)
      : DEFAULT_FAN_BACKTEST_CONFIG.ema200RisingBars ?? 21,
    startCash: typeof b.startCash === 'number' && b.startCash > 0 ? b.startCash : 10_000,
    riskPct: typeof b.riskPct === 'number' && b.riskPct > 0 ? Math.min(b.riskPct, 100) : 1,
    maxPositions: typeof b.maxPositions === 'number' && b.maxPositions >= 1 ? Math.min(Math.floor(b.maxPositions), 50) : 4,
    windowMonths: typeof b.windowMonths === 'number' && b.windowMonths >= 0 ? Math.floor(b.windowMonths) : 3,
  };
}

export function runFanBacktest(
  universe: Stock[],
  config: FanBacktestConfig,
  onProgress?: (p: FanBacktestProgress) => void,
): FanBacktestResult {
  return backtestFanUniverse(universe.map(subjectFromStock), config, onProgress);
}
