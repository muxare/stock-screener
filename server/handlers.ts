// handlers.ts — thin screen request handler (SAD#5.7).
//
// Transport-agnostic: takes a parsed request + the warm universe and returns a
// plain result object. `index.ts` wraps this in an HTTP/JSON endpoint. Kept thin
// per SAD#5.7 — it resolves a rule set and delegates evaluation to the engine.

import { PRESETS } from '../src/lib/market.ts';
import type { BacktestProgress, BacktestResult, Rule, Stock } from '../src/lib/market.ts';
import { runScreen, toRow } from './screen.ts';
import type { ScreenRow } from './screen.ts';
import { runBacktest, NAIVE_LABEL } from './backtest.ts';

export interface ScreenRequest {
  // Built-in preset id (resolved from the shared engine's PRESETS) whose rules
  // seed the screen; optional.
  preset?: string;
  // Additional rules ANDed onto the preset (the client's "custom rules").
  rules?: Rule[];
  // Result-page window over the matched set (SAD#5.7: paginate large results).
  limit?: number;
  offset?: number;
}

export interface ScreenResponse {
  total: number;        // matched names in the full universe
  count: number;        // rows returned in this page
  offset: number;
  limit: number;
  elapsedMs: number;    // server-side evaluation time
  tickers: string[];    // every matched ticker (full set, not paginated)
  results: ScreenRow[]; // paginated row projection
}

const DEFAULT_LIMIT = 500;

// Shared shape of a rule-bearing request: a built-in preset, custom rules, or
// both. Screen and backtest resolve their rule set the same way.
interface RuleRequest {
  preset?: string;
  rules?: Rule[];
}

function resolveRules(req: RuleRequest): Rule[] {
  const rules: Rule[] = [];
  if (req.preset) {
    const preset = PRESETS.find((p) => p.id === req.preset);
    if (!preset) throw new RequestError(`unknown preset "${req.preset}"`);
    rules.push(...preset.rules);
  }
  if (req.rules) {
    if (!Array.isArray(req.rules)) throw new RequestError('"rules" must be an array');
    rules.push(...req.rules);
  }
  return rules;
}

// Signals a 400-class client error to the transport layer.
export class RequestError extends Error {}

export function handleScreen(universe: Stock[], req: ScreenRequest): ScreenResponse {
  const rules = resolveRules(req);

  const start = performance.now();
  const matched = runScreen(universe, rules);
  const elapsedMs = performance.now() - start;

  const offset = Math.max(0, Math.trunc(req.offset ?? 0));
  const limit = Math.max(0, Math.trunc(req.limit ?? DEFAULT_LIMIT));
  const page = matched.slice(offset, offset + limit);

  return {
    total: matched.length,
    count: page.length,
    offset,
    limit,
    elapsedMs,
    tickers: matched.map((s) => s.ticker),
    results: page.map(toRow),
  };
}

// Universe facts (STORY-028): the count + sector facets the client shows at load
// ("of N" total, sector filter list), derived WITHOUT serialising a per-name row
// payload. `bootstrap()` used to pull a full `ScreenResponse` (every row + its
// 40-point sparkline) just to read `total` and the distinct sectors; this is the
// count/facets-only shape that replaces that. Still server-side (SAD#2.5) over
// the same warm universe; it is a payload-shape change, not a move of compute.
export interface FactsResponse {
  total: number;          // full-universe count (the "of N" total)
  sectors: string[];      // distinct sector facets, sorted
  sample: string | null;  // one ticker for the indicator-builder preview (null if empty)
}

export function handleFacets(universe: Stock[]): FactsResponse {
  const sectors = [...new Set(universe.map((s) => s.sector))].sort();
  return {
    total: universe.length,
    sectors,
    sample: universe.length ? universe[0].ticker : null,
  };
}

export interface BacktestRequest {
  // Built-in preset id whose rules seed the backtest; optional.
  preset?: string;
  // Additional rules ANDed onto the preset (the client's "custom rules"). Rank
  // rules are accepted but excluded from history (SAD#3.8), as on the client.
  rules?: Rule[];
}

// Single summary payload (SAD#6.5): the engine's BacktestResult plus the
// server-side elapsed time and the SAD#2.7 naive-fidelity label.
export interface BacktestResponse extends BacktestResult {
  elapsedMs: number;
  label: string;
}

export function handleBacktest(
  universe: Stock[],
  req: BacktestRequest,
  onProgress?: (p: BacktestProgress) => void,
): BacktestResponse {
  const rules = resolveRules(req);

  const start = performance.now();
  const result = runBacktest(universe, rules, onProgress);
  const elapsedMs = performance.now() - start;

  return { ...result, elapsedMs, label: NAIVE_LABEL };
}
