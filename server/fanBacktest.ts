// fanBacktest.ts — server wrapper over the fan-entry backtest engine.
//
// Hardening 2.2 split the body parser in two. Whether a body is the right kind
// of thing is `BacktestRequestSchema` (server/schemas/screen.ts), which Fastify
// runs before the route and which also documents the request in OpenAPI; what
// the values *mean* — the strategy, the defaults, the clamps — is still decided
// here and in `src/lib/strategy/parse.ts`.

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
import { BacktestRequestSchema } from './schemas/screen.ts';
import type { BacktestBody } from './schemas/screen.ts';
import { parseBody } from './schemas/validate.ts';

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

/**
 * The meaning half of a `/backtest` body: defaults, floors and clamps over a body
 * whose shape `BacktestRequestSchema` has already checked. The route calls this
 * after Fastify has validated the request; out-of-range values are defaulted or
 * clamped rather than refused, as they always were, because the UI can send them
 * from an input mid-edit and a backtest with a sane default is the better answer.
 */
export function backtestConfigFromBody(b: BacktestBody): FanBacktestConfig {
  const strategy = parseStrategyField(b.strategy);
  const horizons = (b.horizons ?? DEFAULT_FAN_BACKTEST_CONFIG.horizons).filter((h) => h > 0);
  return {
    strategy,
    horizons: horizons.length ? horizons : DEFAULT_FAN_BACKTEST_CONFIG.horizons,
    minAvgVol: b.minAvgVol != null && b.minAvgVol >= 0 ? b.minAvgVol : 0,
    minMarketCap: b.minMarketCap != null && b.minMarketCap >= 0 ? b.minMarketCap : 0,
    ema200RisingBars: b.ema200RisingBars != null && b.ema200RisingBars >= 0
      ? Math.floor(b.ema200RisingBars)
      : DEFAULT_FAN_BACKTEST_CONFIG.ema200RisingBars ?? 21,
    startCash: b.startCash != null && b.startCash > 0 ? b.startCash : 10_000,
    riskPct: b.riskPct != null && b.riskPct > 0 ? Math.min(b.riskPct, 100) : 1,
    maxPositions: b.maxPositions != null && b.maxPositions >= 1 ? Math.min(Math.floor(b.maxPositions), 50) : 4,
    windowMonths: b.windowMonths != null && b.windowMonths >= 0 ? Math.floor(b.windowMonths) : 3,
  };
}

/** Shape, then meaning, for a body that did not come through the router. */
export function parseFanBacktestBody(body: unknown): FanBacktestConfig {
  return backtestConfigFromBody(parseBody(BacktestRequestSchema, body ?? {}));
}

export function runFanBacktest(
  universe: Stock[],
  config: FanBacktestConfig,
  onProgress?: (p: FanBacktestProgress) => void,
): FanBacktestResult {
  return backtestFanUniverse(universe.map(subjectFromStock), config, onProgress);
}
