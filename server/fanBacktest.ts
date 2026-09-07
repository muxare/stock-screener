// fanBacktest.ts — server wrapper over the fan-entry backtest engine.

import {
  backtestFanUniverse,
  subjectFromStock,
  DEFAULT_FAN_BACKTEST_CONFIG,
  type FanBacktestConfig,
  type FanBacktestProgress,
  type FanBacktestResult,
} from '../src/lib/fanBacktest.ts';
import { parseStrategyRef, StrategyParseError } from '../src/lib/strategy/parse.ts';
import type { Stock } from '../src/lib/market.ts';
import { RequestError } from './handlers.ts';

export type { FanBacktestConfig, FanBacktestResult, FanBacktestProgress };
export { DEFAULT_FAN_BACKTEST_CONFIG };

/** Preset id string or a StrategyDef object; a missing strategy means the default preset. */
export function parseStrategyField(v: unknown): FanBacktestConfig['strategy'] {
  if (v === undefined) return DEFAULT_FAN_BACKTEST_CONFIG.strategy;
  try {
    return parseStrategyRef(v);
  } catch (e) {
    if (e instanceof StrategyParseError) throw new RequestError(e.message);
    throw e;
  }
}

export function parseFanBacktestBody(body: unknown): FanBacktestConfig {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const strategy = parseStrategyField(b.strategy);
  const horizons = Array.isArray(b.horizons)
    ? b.horizons.filter((h): h is number => typeof h === 'number' && h > 0)
    : DEFAULT_FAN_BACKTEST_CONFIG.horizons;
  return {
    strategy,
    horizons: horizons.length ? horizons : DEFAULT_FAN_BACKTEST_CONFIG.horizons,
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
