---
id: EPIC-005
type: epic
parent: ~
sad: SAD-002
sad_refs: SAD-002#1, SAD-002#3, SAD-002#5, SAD-002#6, SAD-002#8.1
capabilities: CAP-dag-model, CAP-dag-lower, CAP-dag-eval, CAP-algebra, CAP-relational, CAP-pattern-nodes, CAP-dag-compat, CAP-dag-fidelity, CAP-dag-schedulable
---

# EPIC-005 — Layered Indicator Calculus (computation DAG)

Restructure the flat per-`defSig` indicator engine (`SAD-001#5.1`) into an
explicit **computation DAG**: raw OHLCV at the root, every indicator declaring
its inputs, *level* derived as topological depth, and a topological memoising
evaluator that computes each node once per instrument-bar and only when a rule
reaches it. The refactor is in-place behind the unchanged public surface, gated
by a differential fidelity harness, with a schedulability seam reserved for the
deferred temporal layer. Scope is PLAN-002 / SAD-002.

## Goal
The engine is a DAG of immutable nodes with derived levels (SAD-002#2.6),
evaluated by a memoising topological evaluator that dedups shared sub-expressions
and prunes unreferenced ones (SAD-002#2.4), reproducing the current engine
**bar-for-bar** over the golden-master fixtures (SAD-002#2.1) with no consumer
changes (SAD-002#2.3) and no latency regression (SAD-002#2.5).

## Capabilities covered
- `CAP-dag-model` (SAD-002#3.1) — node/expression graph data model + identity
- `CAP-dag-lower` (SAD-002#3.2) — lowering existing indicators/rules/PCF to nodes
- `CAP-dag-eval` (SAD-002#3.3) — topological memoising evaluator
- `CAP-algebra` (SAD-002#3.4) — algebraic combinator nodes (`+ − × ÷`)
- `CAP-relational` (SAD-002#3.5) — relational/boolean nodes (`> < ≥ ≤ == !=`, `cross_*`)
- `CAP-pattern-nodes` (SAD-002#3.6) — price-action patterns as boolean DAG nodes
- `CAP-dag-compat` (SAD-002#3.7) — backward-compatible public surface
- `CAP-dag-fidelity` (SAD-002#3.8) — differential fidelity harness (CI gate)
- `CAP-dag-schedulable` (SAD-002#3.9) — schedulability contract (seam only)

## Scope guardrails (SAD-002#1.2)
No temporal sequencing, no new indicator math, no greenfield rewrite, no
authoring-UX overhaul, no server/materialisation implementation, no persisted
def/rule schema change or migration. Stories building any of these are invalid.

## Notes
- Features under this epic live in `backlog/features/FEAT-*.md` with `parent: EPIC-005`.
- All work is inside the pure engine module (`src/lib/market.ts`, or a co-located
  pure module it re-exports) and its tests — no new container (SAD-002#4),
  no I/O, engine purity preserved (SAD-002#2.2).
