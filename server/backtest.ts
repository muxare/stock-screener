// backtest.ts — full-universe backtest composition (SAD#5.7 / SAD#2.4).
//
// Like `screen.ts`, this is the service-layer composition of the SHARED engine,
// not a second engine (SAD#8.3 / ADR-003): it calls the same `backtestRules`
// entry point the browser store uses (`src/store.ts` `openBacktest`), so server
// and client backtests are identical by construction.

import { backtestRules } from '../src/lib/market.ts';
import type { BacktestProgress, BacktestResult, Rule, Stock } from '../src/lib/market.ts';

// Backtest the full universe over full available history. Rank (cross-sectional)
// rules are excluded from history exactly as the client does (SAD#3.8): a rank
// filter is a "now" snapshot with no per-bar meaning, so it cannot be replayed
// across the series.
export function runBacktest(
  universe: Stock[],
  rules: Rule[],
  onProgress?: (p: BacktestProgress) => void,
): BacktestResult {
  const history = rules.filter((r) => r.kind !== 'rank');
  return backtestRules(universe, history, undefined, onProgress);
}

// SAD#2.7 naive-fidelity label travelling with the SAD#6.5 payload — the same
// copy the client backtest surface shows.
export const NAIVE_LABEL =
  'Demo data for illustrating the workflow — not investment advice. ' +
  'Ranking filters are excluded from history.';
