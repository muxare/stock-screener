---
id: STORY-040
type: story
parent: FEAT-013
capability: CAP-dag-eval
sad_refs: [SAD-002#5.2, SAD-002#6.3, SAD-002#2.4, SAD-002#2.7, SAD-002#2.5]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer, I want a topological, memoising evaluator that computes a
node and its transitive inputs once each per instrument-bar, so that shared
sub-expressions are computed once, unreferenced nodes are never computed, and the
old per-`defSig` cache can be replaced without changing results.

## Context
Depends on the node model (STORY-039). This replaces the `indSeries`/`defSig`
cache mechanism (SAD-001#6.2) with per-(instrument, node-identity) memoisation,
attached to the instrument like today's `_indCache`. It is the engine's new
compute core; lowering (STORY-043) and the compat shims (STORY-045) route through
it. Parity is proven by the harness (STORY-046).

## Acceptance Criteria
- [ ] Given an instrument's bars and a target node, the evaluator computes the
      node and its transitive inputs in **topological order**, bottom-up
      (SAD-002#5.2).
- [ ] Each (instrument, node-identity) is memoised and computed **once**; a node
      shared by multiple targets is not recomputed per referencing target
      (SAD-002#2.4). A node-evaluation counter demonstrates this over a fixture.
- [ ] Evaluation is **pruned** to reachable nodes only: a catalogued-but-
      unreferenced node records **zero** evaluations (SAD-002#2.4).
- [ ] The cache is keyed by node identity (SAD-002#6.3); adding a new node after a
      first evaluation returns a correct, **non-stale** series, and a changed node
      (new identity) yields a new key (SAD-002#2.7).
- [ ] The cache is bounded — it does not grow unbounded across a large
      (multi-hundred-instrument) fixture universe (SAD-002#2.7).
- [ ] The cache is derived/ephemeral, never a source of truth; it is rebuildable
      from bars + nodes (SAD-002#6.3).
- [ ] No latency regression: evaluating the fixture universe through the evaluator
      is within the SAD-001#2.3 budget and ≤ the old path within tolerance
      (SAD-002#2.5); a benchmark demonstrates it.
- [ ] Engine purity preserved: evaluator takes bars in, returns values out, no I/O
      (SAD-002#2.2).

## Architectural Constraints (from SAD)
- Evaluate bottom-up in topological order; memoise by node identity; prune to
  reachable nodes; attach the cache to the instrument like `_indCache`
  (SAD-002#5.2). Do NOT recompute shared inputs per referencing target, evaluate
  unreferenced catalogue nodes, or let the cache grow unbounded.
- The node-evaluation counter is a test/instrumentation affordance, NOT a
  production dependency (SAD-002#7).
- Node identity is the single cache key — no caching series by any other key
  (SAD-002#6.3 / SAD-002#7).

## Out of scope
- The node data model itself — STORY-039.
- Lowering real defs/rules/PCF onto nodes — STORY-043.
- Preserving the public `indSeries`/`eval*` API — STORY-045 (this delivers the
  evaluation engine the shims call).
- The schedulability/topological-order public surface — STORY-047.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/market.ts
- src/lib/dag/**
- src/lib/*.test.ts
