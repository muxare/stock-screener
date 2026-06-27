---
id: IDEA-001
type: idea
---

# IDEA-001 — Layered indicator calculus (levels, patterns, algebra & temporal relations)

Free-form concept: problem sketch, who it's for, rough scope. Refine with
`/refine-idea IDEA-001 PLAN-NNN` (both ids required).

## The core idea — ground the indicator math in explicit calculation *levels*

Today the engine (`src/lib/market.ts`, SAD#5.1) computes every indicator as a
flat, independently-cached scalar series (`indSeries` keyed by `defSig`). There
is no explicit model of *what depends on what*. The proposal is to make the
dependency structure first-class by grouping every calculation into **levels**,
where each level may only consume the levels beneath it:

- **Level 0 — Ground / raw:** the adjusted OHLCV bars themselves
  (`open/high/low/close/volume`, plus derived sources `hl2`, `hlc3`). This is
  its own ground level — everything else is derived from it.
- **Level 1 — Primitive aggregations:** computed *only* from raw — `sma`, `ema`,
  `rsi` (Wilder), rolling hi/lo, volume averages. These are the building blocks.
- **Level 2 — Composites of L1 (and/or raw):** indicators defined in terms of
  level-1 series — e.g. `macd` (EMA12 − EMA26, then EMA9 of that), `stochRsi`
  (stoch of the RSI series), `relVol` (volume ÷ volSMA20), price-vs-EMA %.
- **Level 3+ — Higher-order composites:** anything built on L2 and below, and so
  on recursively. The level of a node is `1 + max(level of its inputs)`.

The point: each indicator declares its **inputs** rather than recomputing from
scratch, so the engine forms a **computation DAG** with raw at the root. Level
is a derived property of the DAG (a topological depth), not a hand-assigned tag.

### Why this matters
- **Correctness & fidelity (SAD#2.1):** shared sub-expressions (e.g. the RSI
  series feeding both an RSI rule and Stoch-RSI) are computed once and reused, so
  there is a single source of truth for each node — fewer ways to drift from the
  POC's numbers.
- **Scalability (SAD#2.5):** an explicit DAG is exactly what you need to schedule
  computation server-side, materialise/precompute the lower levels once per bar,
  and only recompute what a rule actually touches. The current "compute every
  indicator for every bar of every name" approach is the #1 thing that doesn't
  survive a universe of thousands of names.
- **Explainability (SAD#3.10):** "why did this fire" can walk the DAG and show
  the contributing levels, not just the top-level boolean.
- **Authoring:** the indicator/setup builders (CAP-indicators SAD#3.3,
  CAP-setups SAD#3.4) gain a principled vocabulary — users compose new
  higher-level indicators out of existing lower-level ones instead of only
  picking from a fixed `INDICATOR_TYPES` catalogue.

## Beyond pure levels — the other node *kinds* in the same calculus

Levels alone aren't enough; the engine already has richer structure that should
live in the same DAG model as distinct node kinds:

1. **Structural / price-action patterns** (CAP-patterns SAD#3.7) — multi-bar
   candle structures (`consec_up/down`, higher-high+higher-low, inside/outside
   bar, engulfing, gaps, N-bar breakouts, RSI divergence, doji). These are
   *boolean structure detectors* over raw + indicator levels — a node kind that
   emits flags rather than a scalar series.
2. **Algebraic combinators** — `+ − × ÷` (and the existing per-operand
   `×mult/+add`, `hl2`, `hlc3`) generalised into first-class arithmetic nodes, so
   an indicator can literally be `(EMA18 − EMA50) / ATR` and that expression is a
   node with its own level.
3. **Relational / comparison operators** — `> < == != ≥ ≤`, plus the existing
   `cross_up`/`cross_down`. These turn scalar nodes into boolean nodes (the edge
   between "math" levels and "logic" levels).
4. **Temporal relations / sequencing** — the genuinely new piece. A *temporal
   algebra* expressing setups that unfold **over time**, e.g.:
   > "First require `EMA18 > EMA50 > EMA100 > EMA200` (stacked uptrend). **Then
   > wait for** a reaction: a candle whose lower tail pierces EMA18 **while**
   > EMA18 never crosses EMA50. **Then** the candle's high reclaims EMA18. **Then**
   > arm an entry within a price range with an established stop-loss."

   This needs operators the current per-bar `evalRuleAt` model can't express:
   sequence (`THEN`), windowed wait (`WITHIN n bars`), persistence/invariance
   (`WHILE … never …`), and onset/edge detection. Think Allen-style interval
   relations or a small temporal-logic layer (a state machine per setup) sitting
   on top of the per-bar evaluators.

## Rough scope / shape (to be sharpened in refinement)
- A small **expression/graph model** for indicator defs: a node references its
  input node(s) + an op; `level` is derived; existing `IndicatorDef` becomes one
  node kind among several (raw-source, aggregation, algebraic, relational,
  pattern, temporal).
- An **evaluator** that topologically walks the DAG, memoising per (node, bar)
  — generalising today's `indSeries` cache from "one series per def" to "one
  series per node", and adding a temporal/state-machine evaluator for sequenced
  setups.
- Keep **SAD#2.1 numeric fidelity** non-negotiable: the lower levels must still
  reproduce the POC bar-for-bar; this is a *restructuring + extension*, not a
  re-derivation of the existing math.
- Engine stays pure/isomorphic (SAD#2.6 / ADR-002): the DAG is data; no DOM,
  no fetch, bars passed in.

## Open questions
- Is the temporal layer v1 scope, or a follow-on once the level/DAG refactor and
  algebraic/relational nodes land? (Strong candidate to split.)
- How does this interact with TC2000 PCF parsing (CAP-pcf SAD#3.5) — does the
  parser target the new node model, or stay a separate front-end that lowers
  into it?
- Backtest semantics for temporal setups: a sequenced setup "fires" on the bar
  the final step completes — how does that map onto `backtestRules`' per-bar walk
  and forward-return horizons (SAD#3.11)?
- UX: how do users *author* a temporal sequence without it becoming a
  visual-programming rabbit hole? (A guided "step 1 → step 2 → …" builder?)
- Performance: does materialising lower levels per bar across the universe
  actually hit the SAD#2.3/2.4 latency budgets, and where does it run
  (client/server/precomputed, SAD#2.5)?

## Related anchors
SAD#5.1 (engine), SAD#3.3 CAP-indicators, SAD#3.4 CAP-setups, SAD#3.6
CAP-screens, SAD#3.7 CAP-patterns, SAD#3.11 CAP-backtest, SAD#2.1 numeric
fidelity, SAD#2.5 scalability, SAD#2.6 engine portability.
