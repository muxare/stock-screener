// schemas/rows.ts — the engine's row shapes as the wire carries them.
//
// `FanRow`, `FanSignalRow`, `IndicatorSnapshot` and `InstrumentBars` are
// TypeScript interfaces in `src/lib/`, shared by the browser and the service,
// and they stay the engine's own definition. These schemas are the *wire*
// definition of the same shapes, and the two are pinned together at compile time
// in `schemas.test.ts`: if either side gains, loses or retypes a field without
// the other, `npm run typecheck` fails. That pin is what makes the claim "every
// shape is defined once" true in practice: there are two declarations, but they
// cannot disagree.
//
// The objects are strict about what they emit: the response serialiser strips
// keys the schema does not name, so a field added to the engine and not here
// would silently vanish from the wire — the compile-time pin is what stops that.

import { z } from 'zod';
import { wireNumber } from './common.ts';

export const IndicatorSnapshotSchema = z
  .object({
    volume: wireNumber.describe('Volume on the last bar, in shares.'),
    rsi14: wireNumber.describe('RSI(14), 0-100.'),
    stochK: wireNumber.describe('Stoch RSI(14, 14, 3, 3) %K, 0-100.'),
    stochD: wireNumber.describe('Stoch RSI %D, 0-100.'),
    perf1m: wireNumber.describe('Fraction: close / close 21 bars ago - 1.'),
    perf3m: wireNumber.describe('Fraction: close / close 63 bars ago - 1.'),
    atrPct: wireNumber.describe('Fraction: ATR(14) / close.'),
    hi52: wireNumber.describe('Highest high over the last 252 bars.'),
    lo52: wireNumber.describe('Lowest low over the last 252 bars.'),
  })
  .meta({ id: 'IndicatorSnapshot', description: 'Last-bar indicators; null where the history is too short.' });

const ema200Ago = z
  .object({ 21: wireNumber.nullable(), 63: wireNumber.nullable(), 105: wireNumber.nullable() })
  .describe('The 200-EMA 21 / 63 / 105 bars ago; null when the history is too short.');

export const FanRowSchema = z
  .object({
    ticker: z.string(),
    name: z.string(),
    sector: z.string(),
    price: wireNumber,
    changePct: wireNumber.describe('Percent change on the day (1.5 = +1.5%).'),
    ema18: wireNumber,
    ema50: wireNumber,
    ema100: wireNumber,
    ema200: wireNumber,
    ema200Ago,
    worstGap: wireNumber.describe('Tightest adjacent EMA gap as a fraction of the slower EMA; negative = inverted.'),
    sparkline: z.array(wireNumber),
    avgVol20: wireNumber,
    relVol: wireNumber,
    marketCap: wireNumber.nullable(),
    snapshot: IndicatorSnapshotSchema,
  })
  .meta({ id: 'FanRow' });

export const FanSignalRowSchema = z
  .object({
    ticker: z.string(),
    name: z.string(),
    sector: z.string(),
    price: wireNumber,
    changePct: wireNumber,
    strategy: z.string().describe('Strategy id (preset or saved).'),
    entryDate: z.string().nullable().describe('Calendar date of the entry bar, when the dataset carries dates.'),
    barsAgo: wireNumber.describe('Bars between the entry and the latest bar (0 = entered on the last bar).'),
    entryPrice: wireNumber,
    stopPrice: wireNumber,
    riskPerShare: wireNumber.describe('Initial risk per share (entry - stop) = 1R, in price.'),
    riskPct: wireNumber.describe('1R as a percent of the entry price.'),
    targetLoR: wireNumber,
    targetHiR: wireNumber,
    targetLoPrice: wireNumber,
    targetHiPrice: wireNumber,
    openR: wireNumber.describe('Mark-to-market R at the latest close.'),
    avgVol20: wireNumber,
    marketCap: wireNumber.nullable(),
    sparkline: z.array(wireNumber),
    snapshot: IndicatorSnapshotSchema,
  })
  .meta({ id: 'FanSignalRow' });

export const BarSchema = z.object({ o: wireNumber, h: wireNumber, l: wireNumber, c: wireNumber, v: wireNumber });

export const InstrumentBarsSchema = z
  .object({
    ticker: z.string(),
    name: z.string(),
    sector: z.string(),
    bars: z.array(BarSchema).describe('Adjusted daily OHLCV, oldest first.'),
    dates: z.array(z.string()).optional().describe("'YYYY-MM-DD', parallel to bars, when the dataset carries dates."),
    sharesOutstanding: wireNumber.optional(),
  })
  .meta({ id: 'InstrumentBars' });
