// screen.ts — full-universe screen evaluation (SAD#5.7).
//
// This is the data/service-layer composition of the SHARED engine, not a second
// engine (SAD#8.3 / ADR-003): it calls the same `evalGroupedRules` /
// `rankPassSet` entry points that the browser store uses (`src/store.ts`
// `screenList`), so server and client produce identical results by construction.

import { evalGroupedRules, rankPassSet } from '../src/lib/market.ts';
import type { Rule, RankRule, Stock } from '../src/lib/market.ts';

// Filter the universe by a rule set, mirroring the client's `screenList`:
// grouped (AND/OR) rules are evaluated per-name; cross-sectional `rank` rules
// are applied afterwards against the whole universe.
export function runScreen(universe: Stock[], rules: Rule[]): Stock[] {
  const rankRules = rules.filter((r) => r.kind === 'rank') as RankRule[];
  const grouped = rules.filter((r) => r.kind !== 'rank');
  let listed = universe.filter((s) => evalGroupedRules(s, grouped));
  for (const rr of rankRules) {
    const pass = rankPassSet(universe, rr);
    listed = listed.filter((s) => pass.has(s.ticker));
  }
  return listed;
}

// Compact per-match projection returned over the wire — the scalar columns the
// results table renders (SAD#5.2), not the full Stock (which carries large
// indicator arrays). Includes the MACD/Stoch/EMA-trend scalars and the 40-day
// `sparkline` the table draws, so the client renders a match row without
// fetching that name's bars (SAD#2.5: only displayed names pull bars).
export interface ScreenRow {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  rsi: number;
  macdHist: number;
  stochK: number;
  relVol: number;
  ema20: number;
  ema50: number;
  ema200: number;
  pct52w: number;
  sparkline: number[];
}

export function toRow(s: Stock): ScreenRow {
  return {
    ticker: s.ticker,
    name: s.name,
    sector: s.sector,
    price: s.price,
    changePct: s.changePct,
    rsi: s.rsi,
    macdHist: s.macdHist,
    stochK: s.stochK,
    relVol: s.relVol,
    ema20: s.ema20,
    ema50: s.ema50,
    ema200: s.ema200,
    pct52w: s.pct52w,
    sparkline: s.sparkline,
  };
}
