// signals.ts — full-universe live "current entry" screen.
//
// Composition of `src/lib/fanSignals.ts` over the warm universe, mirroring
// `screen.ts`. Maps each warm Stock into a signal subject (full OHLC + the
// display/filter fields) and returns the names with an open entry.

import { screenFanSignals, signalScanConfig } from '../src/lib/fanSignals.ts';
import type { FanSignalRow, FanSignalSubject } from '../src/lib/fanSignals.ts';
import type { FanBacktestConfig } from '../src/lib/fanBacktest.ts';
import type { Stock } from '../src/lib/market.ts';
import { RequestError } from './handlers.ts';
import { parseStrategyField } from './fanBacktest.ts';
import { SignalsRequestSchema } from './schemas/screen.ts';
import type { SignalsBody } from './schemas/screen.ts';
import { parseBody } from './schemas/validate.ts';

export type { FanSignalRow };

/**
 * The meaning half of a `/signals` body, over a body whose shape
 * `SignalsRequestSchema` has already checked. An empty-string strategy is the
 * one "missing" the schema cannot see, so it is refused here in the same words.
 */
export function signalsConfigFromBody(b: SignalsBody): FanBacktestConfig {
  if (b.strategy === '') throw new RequestError('unknown or missing strategy');
  const strategy = parseStrategyField(b.strategy);
  const num = (v: number | null | undefined, d = 0) => (v != null && v >= 0 ? v : d);
  return signalScanConfig(strategy, {
    minAvgVol: num(b.minAvgVol),
    minMarketCap: num(b.minMarketCap),
    ema200RisingBars: Math.floor(num(b.ema200RisingBars, 21)),
  });
}

/**
 * Shape, then meaning, for a body that did not come through the router. The MCP
 * `scan_signals` tool calls this, which is what keeps it accepting and refusing
 * exactly the strategies `/signals` does: the same schema, then the same parser.
 * Throws RequestError on a malformed body or a missing or invalid strategy.
 */
export function parseFanSignalsBody(body: unknown): FanBacktestConfig {
  return signalsConfigFromBody(parseBody(SignalsRequestSchema, body ?? {}));
}

function subjectFromStock(s: Stock): FanSignalSubject {
  return {
    ticker: s.ticker,
    name: s.name,
    sector: s.sector,
    price: s.price,
    changePct: s.changePct,
    sparkline: s.sparkline,
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

export function runFanSignals(universe: Stock[], config: FanBacktestConfig): FanSignalRow[] {
  return screenFanSignals(universe.map(subjectFromStock), config);
}
