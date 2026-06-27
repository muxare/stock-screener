---
id: PLAN-002
type: plan
parent: IDEA-001
source_kind: idea
---

# Project Plan — Layered Indicator Calculus (computation DAG)

Derived from `backlog/ideas/IDEA-001.md`. Restructures the indicator engine in
`src/lib/market.ts` (SAD#5.1) from a flat set of independently-cached scalar
series into an explicit **computation DAG**: raw OHLCV at the root, every
indicator declaring its inputs, and *level* derived as topological depth. Scope
is the DAG model + node kinds (raw, aggregation, algebraic, relational,
pattern). The **temporal sequencing layer is deliberately deferred** to a
follow-on idea (see Non-goals).

## Problem
The engine computes every indicator as a flat scalar series (`indSeries` keyed
by `defSig`) with **no model of what depends on what**. Three consequences:

1. **Scalability (primary driver, SAD#2.5):** there is no structure to schedule,
   materialise, or prune against. The POC's "compute every indicator for every
   bar of every name in the client" approach is the single biggest thing that
   does not survive a universe of thousands of names. Without an explicit
   dependency graph, the screening service (SAD#4.2) cannot compute lower levels
   once per bar and recompute only the nodes a given rule actually touches.
2. **Reuse / single source of truth:** shared sub-expressions (e.g. the RSI
   series feeding both an RSI rule and Stoch-RSI) are re-derived per def rather
   than computed once and shared.
3. **Limited composition:** users pick from a fixed `INDICATOR_TYPES` catalogue;
   there is no principled way to build a higher-level indicator out of existing
   lower-level ones, or to express `(EMA18 − EMA50) / ATR` as a first-class node.

## Target users
Two audiences, in priority order:
- **The system itself / the screening service (SAD#4.2)** — the DAG is
  infrastructure that lets computation be scheduled and scaled off the client.
  This is who the *primary driver* serves.
- **Power users** (the PLAN-001 trader persona) who build custom indicators and
  multi-condition setups — they benefit later from composing higher-level nodes
  from lower-level ones, but expressiveness is the secondary win here, not the
  goal.

## Success metrics
(measurable)
- **Fidelity preserved:** the refactored engine reproduces the current
  `market.ts` output **bar-for-bar** over the existing fixture series — zero
  divergence (SAD#2.1). This is the gate, not a target.
- **Shared sub-expressions computed once:** a screen referencing N indicators
  that share a common input node computes that node a single time per
  instrument-bar (measurable via a node-evaluation counter), vs. once per
  referencing def today.
- **Prunable evaluation:** evaluating a rule touches only its transitive input
  nodes — demonstrable by a node that is in the catalogue but unreferenced never
  being computed.
- **Schedulability:** the DAG can be topologically ordered and the lower levels
  materialised independently of any single rule — a precondition the screening
  service (SAD#4.2 / SAD#2.5) can build on.
- **No screening-latency regression** over the current universe (SAD#2.3); ideally
  an improvement from dedup of shared sub-expressions.

## Constraints
- **Numeric fidelity is non-negotiable (SAD#2.1).** This is a *restructuring +
  extension*, not a re-derivation. Lower levels must match the POC/`market.ts`
  numbers exactly; a fidelity test diffs old vs new engine over a fixed fixture.
- **Refactor in place.** Restructure `src/lib/market.ts` so existing indicators
  (`ema`/`sma`/`rsi`/`macd`/`stochrsi`) **lower into** the DAG model; keep the
  existing public surface (`indSeries`, rule evaluators, `PRESETS`, builder
  catalogues) working so consuming components (SAD#5.2/5.3) and the store don't
  break. Migrate the cache from "one series per def" to "one series per node".
- **Engine stays pure & isomorphic (SAD#2.6 / ADR-002):** the DAG is plain data;
  no DOM, no fetch, no global state, no "today". Bars passed in (ADR-004).
- **Level is derived, not assigned:** a node's level is `1 + max(level of its
  inputs)`; raw sources are level 0. No hand-tagged levels that can drift.
- **TC2000 PCF parity preserved (SAD#3.5):** whatever the parser produces today
  must still evaluate identically — either by lowering into the new node model or
  by keeping the existing front-end and targeting the new evaluator.

## Non-goals
(explicit — flows into SAD#1.2 via `/plan-to-sad PLAN-002 SAD-NNN`)
- **Temporal sequencing is OUT of this plan.** No `THEN` / `WITHIN n bars` /
  `WHILE … never …` / onset-edge / Allen-style interval operators, and no
  per-setup state machine. The per-bar evaluation model is unchanged. Temporal
  algebra is a deliberate follow-on idea that builds *on top of* this DAG once it
  exists — capturing it here would multiply scope and architectural risk.
- **No new indicator math.** This plan adds no new indicator *types*; it
  restructures how the existing ones are computed and composed. (Algebraic and
  relational *combinator* nodes are in scope as composition primitives, but they
  combine existing series — they are not new indicators.)
- **No greenfield replacement.** The current flat engine is not thrown away and
  rewritten from scratch; it is refactored in place with the old path preserved
  until parity is proven.
- **No authoring-UX overhaul in this plan.** Surfacing DAG-composition in the
  indicator/setup builders (SAD#3.3/3.4) and DAG-walking explainability
  (SAD#3.10) are downstream once the model lands — not part of the core refactor.
- **No server/materialisation implementation here.** This plan makes computation
  *schedulable* (the DAG + clean evaluation contract); actually moving it to the
  screening service or a precompute store is the SAD#2.5 follow-through, not this
  scope.
- **No change to backtest semantics (SAD#3.11)** beyond preserving identical
  results — sequenced-setup backtest semantics ride with the temporal follow-on.

## Open questions
- **Node model shape:** is a node a tagged union `{ kind, inputs[], op/params }`
  with `IndicatorDef` becoming one `kind`, or do we keep `IndicatorDef` as-is and
  wrap it? How much of the existing `defSig`/`indSeries` cache key survives?
- **Algebraic/relational granularity:** are `+ − × ÷` and `> < == != ≥ ≤`
  first-class node kinds, or do we generalise the existing per-operand
  `×mult/+add` and the `cond`/`chain` operators into them? (The latter is less
  disruptive; the former is more uniform.)
- **Pattern nodes:** do the existing `PATTERNS` (CAP-patterns, SAD#3.7) become
  boolean DAG nodes consuming raw + indicator levels, or stay a separate
  evaluator the DAG references? Either way their flags must match the POC.
- **Cache lifecycle:** per-instrument node cache keyed by node identity —
  invalidation when a custom EMA window is added (`ensureEma`), and memory cost
  of memoising many nodes across a large universe (ties back to SAD#2.5).
- **PCF lowering:** does `parsePCF` target the new node model directly, or remain
  a front-end that emits today's `GroupRule` which then lowers? (Affects how much
  parser code changes.)
- **Where the boundary to the temporal follow-on sits:** what hooks/contract does
  this DAG need to expose so the later temporal layer can sit on top without a
  second refactor (e.g. addressable per-(node, bar) values, onset queryability)?
