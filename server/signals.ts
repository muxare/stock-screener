// signals.ts — full-universe live "current entry" screen.
//
// Composition of `src/lib/fanSignals.ts` over the warm universe, mirroring
// `screen.ts`. Maps each warm Stock into a signal subject (full OHLC + the
// display/filter fields) and returns the names with an open entry.

import { screenFanSignals, signalScanConfig } from '../src/lib/fanSignals.ts';
import type { FanSignalRow, FanSignalSubject } from '../src/lib/fanSignals.ts';
import type { FanBacktestConfig, FanStrategyId } from '../src/lib/fanBacktest.ts';
import type { Stock } from '../src/lib/market.ts';

export type { FanSignalRow };

const STRATS: FanStrategyId[] = ['onset', 'cross', 'tag18', 'tag50', 'structure', 'dual_ema', 'bunn_bounce', 'bunn_cont'];

export function isFanStrategyId(v: unknown): v is FanStrategyId {
  return typeof v === 'string' && (STRATS as string[]).includes(v);
}

/** Parse the /signals body into a scan config. Throws-free: caller validates strategy. */
export function parseFanSignalsBody(body: unknown): { strategy: FanStrategyId; config: FanBacktestConfig } | null {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  if (!isFanStrategyId(b.strategy)) return null;
  const num = (v: unknown, d = 0) => (typeof v === 'number' && v >= 0 ? v : d);
  const config = signalScanConfig(b.strategy, {
    minAvgVol: num(b.minAvgVol),
    minMarketCap: num(b.minMarketCap),
    ema200RisingBars: Math.floor(num(b.ema200RisingBars, 21)),
  });
  return { strategy: b.strategy, config };
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
