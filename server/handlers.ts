// handlers.ts — thin screen request handler (SAD#5.7).
//
// Transport-agnostic: takes a parsed request + the warm universe and returns a
// plain result object. `index.ts` wraps this in an HTTP/JSON endpoint. Kept thin
// per SAD#5.7 — it resolves a rule set and delegates evaluation to the engine.

import { PRESETS } from '../src/lib/market.ts';
import type { Rule, Stock } from '../src/lib/market.ts';
import { runScreen, toRow } from './screen.ts';
import type { ScreenRow } from './screen.ts';

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

function resolveRules(req: ScreenRequest): Rule[] {
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
