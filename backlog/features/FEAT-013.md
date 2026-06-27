---
id: FEAT-013
type: feature
parent: EPIC-005
sad_refs: SAD-002#5.1, SAD-002#5.2, SAD-002#6.1
capabilities: CAP-dag-model, CAP-dag-eval
---

# FEAT-013 — DAG foundation — node model & memoising evaluator

The two load-bearing pieces of the refactor: the immutable node/expression-graph
data model with derived levels and structural identity (SAD-002#5.1, #6.1), and
the topological memoising evaluator that computes each reachable node once per
instrument-bar and replaces the `defSig` cache (SAD-002#5.2). Everything else
lowers onto this model and runs through this evaluator.

## Parent
EPIC-005

## Capabilities covered
- `CAP-dag-model` (SAD-002#3.1) — node data structure, kind taxonomy, derived
  level, structural identity, acyclicity.
- `CAP-dag-eval` (SAD-002#3.3) — topological, memoising, prunable evaluator with
  a bounded, correctly-invalidated per-(instrument, node) cache.

## Notes
- Create stories via `python tools/board.py new --capability <id> --parent FEAT-013`.
- Build order: CAP-dag-model lands first; CAP-dag-eval depends on it.
