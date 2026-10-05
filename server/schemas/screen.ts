// schemas/screen.ts — the engine surface: `/facts`, `/screen`, `/signals` and
// `/backtest`.
//
// **Shape here, meaning in the parsers.** These schemas decide whether a body is
// the right *kind* of thing: an object, with a strategy that is a string or an
// object carrying a `steps` array, and numbers where numbers go. Whether the
// strategy is a preset that exists, whether its steps make sense together, what
// a negative floor or an over-large risk is clamped to — that is meaning, and it
// stays where it was: `src/lib/strategy/parse.ts` for the strategy, and the
// config builders in `server/fanBacktest.ts` and `server/signals.ts` for the
// rest. Moving it into Zod would give the browser, which runs the same strategy
// parser over localStorage, a second and different definition of a valid
// strategy.
//
// That split also fixes what changed on the wire. Every request the client
// sends is accepted exactly as before. What changed is a body of the wrong
// *type* — a string where a number goes, a strategy that is a number — which the
// hand-written parsers silently replaced with a default and which is now a 400.
// Out-of-range numbers are still defaulted or clamped, as before, because that
// is meaning; and `null` is still accepted wherever a number is, because the UI
// can produce `NaN` from an emptied input and `JSON.stringify` sends it as null.

import { z } from 'zod';
import { FanRowSchema, FanSignalRowSchema } from './rows.ts';

// ---------------------------------------------------------------- requests

/**
 * A strategy as a request names it: a preset id, or a full definition object.
 *
 * The object branch names only the top-level fields `parse.ts` reads, so their
 * types are checked here and any other key is dropped before the parser sees it
 * (it ignored them anyway). Steps and the trade block are left as `unknown`:
 * what a step may contain depends on its type, and that is the strategy parser's
 * job.
 *
 * A union reports its failures as one opaque issue, so it carries its own
 * message; a missing strategy keeps the wording the hand-written parser used.
 */
export const StrategyRefSchema = z.union(
  [
    z.string().describe('A preset strategy id.'),
    z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        builtin: z.boolean().optional(),
        steps: z.array(z.unknown()).describe('The strategy steps; validated by the strategy parser.'),
        trade: z.unknown().optional().describe('Entry, stop and exit specs; validated by the strategy parser.'),
      })
      .describe('A full strategy definition.'),
  ],
  {
    error: (iss) =>
      iss.input === undefined
        ? 'unknown or missing strategy'
        : 'strategy must be a preset id or a definition object with a "steps" array (and string id, name, description)',
  },
);

/** A number the client may send as null; null and absent both mean "the default". */
const optionalNumber = (description: string) => z.number().nullish().describe(description);

const floors = {
  minAvgVol: optionalNumber('Drop names whose 20-bar average volume, in shares, is below this. Default 0.'),
  minMarketCap: optionalNumber('Drop names whose market cap is below this. Default 0.'),
  ema200RisingBars: optionalNumber('Require the 200-EMA above its value this many bars ago. Default 21; 0 disables.'),
};

export const SignalsRequestSchema = z
  .object({ strategy: StrategyRefSchema, ...floors })
  .meta({ id: 'SignalsRequest' });

export const BacktestRequestSchema = z
  .object({
    strategy: StrategyRefSchema.optional().describe('Absent means the default preset (tag50).'),
    horizons: z.array(z.number()).optional().describe('Forward-return horizons in bars; non-positive entries are dropped.'),
    ...floors,
    startCash: optionalNumber('Starting cash for the account simulation. Default 10000.'),
    riskPct: optionalNumber('Percent of equity risked per trade, capped at 100. Default 1.'),
    maxPositions: optionalNumber('Concurrent positions, 1-50. Default 4.'),
    windowMonths: optionalNumber('Months of history the account simulation covers. Default 3.'),
  })
  .meta({ id: 'BacktestRequest' });

export type SignalsRequest = z.input<typeof SignalsRequestSchema>;
export type BacktestRequest = z.input<typeof BacktestRequestSchema>;
export type SignalsBody = z.output<typeof SignalsRequestSchema>;
export type BacktestBody = z.output<typeof BacktestRequestSchema>;

// ---------------------------------------------------------------- responses

export const FactsResponseSchema = z.object({
  total: z.number().describe('Names in the universe.'),
  sectors: z.array(z.string()).describe('Distinct sectors, sorted.'),
  sample: z.string().nullable().describe('One ticker from the universe, or null when it is empty.'),
});

export const ScreenResponseSchema = z.object({
  universe: z.number(),
  elapsedMs: z.number(),
  matches: z.array(FanRowSchema).describe('The full 18 > 50 > 100 > 200 EMA stack holds on the latest bar.'),
  near: z.array(FanRowSchema).describe('Not stacked, but every EMA pair is within 0.5% of stacking.'),
});

export const SignalsResponseSchema = z.object({
  universe: z.number(),
  elapsedMs: z.number(),
  strategy: z.string().describe('Strategy id (preset or saved).'),
  strategyName: z.string(),
  rows: z.array(FanSignalRowSchema),
});

export type FactsResponse = z.output<typeof FactsResponseSchema>;
export type ScreenResponse = z.output<typeof ScreenResponseSchema>;
export type SignalsResponse = z.output<typeof SignalsResponseSchema>;

// ---------------------------------------------------------------- the /backtest stream
//
// `/backtest` answers `application/x-ndjson`: one progress line per name scanned,
// then exactly one result line. The route hijacks the reply and writes the
// socket itself, so Fastify's serialiser never sees these lines and the schemas
// below are documentation, not enforcement. The progress line is small and is
// typed against this schema where the route writes it. The result line is the
// engine's `FanBacktestResult` plus `elapsedMs`, and is described here only to
// its top level: below that it is entries, trades, marks and an account curve,
// and a full schema of it would be a second definition of the engine's result
// type that nothing could check — the stream is never validated. The client
// types it with the engine's own `FanBacktestResult`, which it shares with the
// server already.

export const BacktestProgressLineSchema = z.object({
  type: z.literal('progress'),
  name: z.number().describe('Names scanned so far.'),
  total: z.number().describe('Names to scan.'),
});

export const BacktestResultLineSchema = z
  .looseObject({
    type: z.literal('result'),
    elapsedMs: z.number(),
    config: z.unknown().describe('The resolved backtest config, strategy expanded to its definition.'),
    universe: z.number(),
    stocksScanned: z.number(),
    totalEntries: z.number(),
    stocksWithEntries: z.number(),
    forwardHorizons: z.array(z.unknown()).describe('Forward-return statistics per horizon.'),
    trades: z.unknown().describe('Summary of the simulated trades.'),
    entries: z.array(z.unknown()).describe('Every entry event, with its simulated trade.'),
    factors: z.array(z.unknown()).describe('Win rate / avg R by indicator state at entry.'),
    account: z.unknown().describe('The cash-book simulation over the last windowMonths.'),
  })
  .describe("The engine's FanBacktestResult (src/lib/fanBacktest.ts) plus elapsedMs.");

export const BacktestStreamLineSchema = z
  .discriminatedUnion('type', [BacktestProgressLineSchema, BacktestResultLineSchema])
  .describe('One line of the NDJSON stream.');

export type BacktestProgressLine = z.output<typeof BacktestProgressLineSchema>;
