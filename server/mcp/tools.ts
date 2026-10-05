// mcp/tools.ts — the screener's tools, independent of any transport.
//
// Each tool is a name, a description written for the model, a Zod input schema,
// and a `run` that wraps an existing handler over the warm universe. Nothing
// here computes a screen: `screen_fan` is `handleScreen`, `scan_signals` is
// `handleSignals` behind the same `/signals` body parser, `get_instrument` is
// `UniverseStore.getInstrument`. The engine is not touched.
//
// `runTool` is the handler layer the tests drive directly. It validates the
// arguments itself rather than leaving that to the MCP SDK, because the SDK
// answers a schema violation with a plain-text error before any tool code runs,
// and "every failure is `{ errorCategory, isRetryable, message }`" would then be
// false for exactly the failure a model makes most often. `server.ts` turns the
// outcome into an MCP result. Phase G of `docs/cca-f-learning-plan.md` is meant
// to reuse these definitions for the tool runner, which is the other reason they
// are plain data rather than SDK registrations.
//
// Results are paginated and the per-row sparkline is dropped: a full screen of
// the larger datasets is hundreds of rows with sixty closes each, which is a
// context window spent on numbers nobody asked for.

import { z } from 'zod';
import { handleScreen, handleSignals } from '../handlers.ts';
import { parseFanSignalsBody } from '../signals.ts';
import type { FanRow } from '../screen.ts';
import type { FanSignalRow } from '../signals.ts';
import { PRESET_IDS } from '../../src/lib/strategy/presets.ts';
import type { Datasets } from './datasets.ts';
import { ToolError, toErrorBody } from './errors.ts';
import type { ToolErrorBody } from './errors.ts';

export interface ToolContext {
  datasets: Datasets;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  input: S;
  run(args: z.output<S>, ctx: ToolContext): unknown;
}

const MAX_PAGE = 100;

const dataset = z.string().min(1).optional().describe(
  'Dataset to run against: "synthetic" or a database file name such as "kaggle-market.db". ' +
    'Omit it for the default dataset. The screener://datasets resource lists the names.',
);
const ticker = z.string().min(1).optional().describe(
  'Keep only this ticker (case-sensitive). An empty page means it is not in the list.',
);
const limit = z.number().int().min(1).max(MAX_PAGE).default(20).describe(`Rows per page, 1-${MAX_PAGE}.`);
const offset = z.number().int().min(0).default(0).describe('Index of the first row to return; pass the previous nextOffset.');

function page<T>(rows: T[], from: number, size: number) {
  const slice = rows.slice(from, from + size);
  const next = from + slice.length;
  return { total: rows.length, offset: from, nextOffset: next < rows.length ? next : null, rows: slice };
}

function compact<T extends FanRow | FanSignalRow>(row: T): Omit<T, 'sparkline'> {
  const copy: Partial<T> = { ...row };
  delete copy.sparkline;
  return copy as Omit<T, 'sparkline'>;
}

const screenFanInput = z.object({
  list: z.enum(['matches', 'near']).default('matches').describe(
    '"matches": the full 18>50>100>200 EMA stack holds on the latest bar. "near": not stacked, ' +
      'but every EMA pair is within 0.5% of stacking.',
  ),
  sector: z.string().min(1).optional().describe('Keep only this sector (case-insensitive exact match).'),
  ticker,
  limit,
  offset,
  dataset,
});

const screenFan: ToolDef<typeof screenFanInput> = {
  name: 'screen_fan',
  title: 'EMA-fan screen',
  description: [
    'Classifies every name in the dataset by its EMA fan on the latest bar and returns one page of',
    'either the matches (18 > 50 > 100 > 200 EMA, all stacked) or the near misses. Use it to answer',
    '"which names are in the fan today?" or to find candidates before looking at one closely.',
    '',
    'Do not page through it to find one name — pass ticker, and use get_instrument for its price',
    'history. Do not call it to find trade entries — the fan is a state, not a signal;',
    'scan_signals answers "what entered today".',
    '',
    'Units: price and ema* in the instrument\'s currency; changePct in percent (1.5 = +1.5% on the',
    'day); worstGap is a fraction (0.012 = the tightest EMA pair is 1.2% apart; negative means',
    'inverted); relVol is today\'s volume over the 20-bar average; avgVol20 in shares. Rows are',
    'sorted by worstGap. counts gives both list sizes; page with offset until nextOffset is null.',
    '',
    'Example: {"list": "matches", "limit": 20} then {"list": "matches", "offset": 20}.',
  ].join('\n'),
  input: screenFanInput,
  run(args, ctx) {
    const { name, store } = ctx.datasets.open(args.dataset);
    const result = handleScreen(store.get());
    const want = args.sector?.toLowerCase();
    const rows = result[args.list].filter(
      (r) => (!want || r.sector.toLowerCase() === want) && (!args.ticker || r.ticker === args.ticker),
    );
    return {
      dataset: name,
      universe: result.universe,
      counts: { matches: result.matches.length, near: result.near.length },
      list: args.list,
      ...page(rows.map(compact), args.offset, args.limit),
    };
  },
};

const scanSignalsInput = z.object({
  strategy: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).describe(
    `A preset strategy id (${PRESET_IDS.join(', ')}) or a full strategy definition object ` +
      'as read from the screener://strategies/presets resource.',
  ),
  minAvgVol: z.number().min(0).optional().describe('Drop names whose 20-bar average volume, in shares, is below this.'),
  minMarketCap: z.number().min(0).optional().describe('Drop names whose market cap, in currency units, is below this.'),
  ema200RisingBars: z.number().int().min(0).optional().describe(
    'Require the 200-EMA to be above its value this many bars ago. Default 21; 0 disables.',
  ),
  ticker,
  limit,
  offset,
  dataset,
});

const scanSignals: ToolDef<typeof scanSignalsInput> = {
  name: 'scan_signals',
  title: 'Live strategy entries',
  description: [
    'Runs one entry strategy over every name and returns those with a trade open on the latest bar:',
    'where it entered, the stop, the 1R risk and the 3R target window. Use it for "what does',
    'strategy X say today?" and for comparing strategies or datasets by what they currently hold.',
    '',
    'Do not call it for backtest performance — it reports open trades, not history, and a count of',
    'open entries says nothing about whether a strategy works. Do not call it to learn what a',
    'strategy does — read the screener://strategies/presets resource instead.',
    '',
    'Units: prices in the instrument\'s currency; riskPerShare is 1R in price; riskPct is 1R as a',
    'percent of entryPrice; targetLoR/targetHiR and openR are in R (multiples of the initial risk;',
    'openR 1.0 = up one risk unit at the latest close); barsAgo in trading bars since entry (0 =',
    'entered on the latest bar). Costs are not modelled.',
    '',
    'Example: {"strategy": "tag50", "minAvgVol": 100000, "limit": 20}.',
  ].join('\n'),
  input: scanSignalsInput,
  run(args, ctx) {
    const { name, store } = ctx.datasets.open(args.dataset);
    // The /signals body parser, so the MCP tool and the HTTP route accept and
    // refuse exactly the same strategies. Its RequestError becomes invalid_input.
    const config = parseFanSignalsBody({
      strategy: args.strategy,
      minAvgVol: args.minAvgVol,
      minMarketCap: args.minMarketCap,
      ema200RisingBars: args.ema200RisingBars,
    });
    const result = handleSignals(store.get(), config);
    return {
      dataset: name,
      universe: result.universe,
      strategy: result.strategy,
      strategyName: result.strategyName,
      ...page(
        result.rows.filter((r) => !args.ticker || r.ticker === args.ticker).map(compact),
        args.offset,
        args.limit,
      ),
    };
  },
};

const getInstrumentInput = z.object({
  ticker: z.string().min(1).describe('The ticker exactly as the screener lists it; case-sensitive.'),
  bars: z.number().int().min(1).max(1000).default(60).describe('How many of the most recent daily bars to return, 1-1000.'),
  dataset,
});

const getInstrument: ToolDef<typeof getInstrumentInput> = {
  name: 'get_instrument',
  title: 'One instrument\'s bars',
  description: [
    'Returns the most recent daily OHLCV bars for one ticker, oldest first, with its name and',
    'sector. Use it to look at the price history behind a screen or signal row, or to check a',
    'level the user mentions.',
    '',
    'Do not call it once per name to screen a list — screen_fan and scan_signals already cover',
    'the whole dataset in one call. Ask for only as many bars as the question needs: 60 is about',
    'three months, 260 about a year.',
    '',
    'Units: o/h/l/c in the instrument\'s currency, adjusted; v in shares; date is YYYY-MM-DD (null',
    'when the dataset carries no dates). totalBars is the full history length.',
    '',
    'Example: {"ticker": "AAPL", "bars": 20}.',
  ].join('\n'),
  input: getInstrumentInput,
  run(args, ctx) {
    const { name, store } = ctx.datasets.open(args.dataset);
    const inst = store.getInstrument(args.ticker);
    if (!inst) {
      throw new ToolError(
        'unknown_ticker',
        `no instrument "${args.ticker}" in dataset ${name}. Tickers are case-sensitive; screen_fan lists the names this dataset has.`,
      );
    }
    const from = Math.max(0, inst.bars.length - args.bars);
    return {
      dataset: name,
      ticker: inst.ticker,
      name: inst.name,
      sector: inst.sector,
      sharesOutstanding: inst.sharesOutstanding ?? null,
      totalBars: inst.bars.length,
      bars: inst.bars.slice(from).map((b, i) => ({ date: inst.dates?.[from + i] ?? null, ...b })),
    };
  },
};

export const TOOLS: readonly ToolDef[] = [screenFan, scanSignals, getInstrument] as ToolDef[];

/** The JSON Schema a client is shown for a tool's arguments. */
export function inputJsonSchema(tool: ToolDef): { type: 'object'; [k: string]: unknown } {
  const schema = z.toJSONSchema(tool.input, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return { ...schema, type: 'object' };
}

export type ToolOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: ToolErrorBody; cause?: unknown };

/**
 * Validate and run one tool. Never throws: every failure comes back as the
 * structured body, with the original error attached for logging when it was
 * one of ours.
 */
export function runTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolOutcome {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    const known = TOOLS.map((t) => t.name).join(', ');
    return { ok: false, error: toErrorBody(new ToolError('invalid_input', `unknown tool "${name}"; available: ${known}`)) };
  }
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: toErrorBody(new ToolError('invalid_input', `invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`)),
    };
  }
  try {
    return { ok: true, value: tool.run(parsed.data, ctx) };
  } catch (err) {
    const error = toErrorBody(err);
    return { ok: false, error, cause: error.errorCategory === 'internal' ? err : undefined };
  }
}
