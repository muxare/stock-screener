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

export type { FanSignalRow };

/** Parse the /signals body into a scan config. Throws RequestError on a missing or invalid strategy. */
export function parseFanSignalsBody(body: unknown): FanBacktestConfig {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  if (b.strategy === undefined || b.strategy === '') throw new RequestError('unknown or missing strategy');
  const strategy = parseStrategyField(b.strategy);
  const num = (v: unknown, d = 0) => (typeof v === 'number' && v >= 0 ? v : d);
  return signalScanConfig(strategy, {
    minAvgVol: num(b.minAvgVol),
    minMarketCap: num(b.minMarketCap),
    ema200RisingBars: Math.floor(num(b.ema200RisingBars, 21)),
  });
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
