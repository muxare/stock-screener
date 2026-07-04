---
id: FEAT-015
type: feature
parent: EPIC-005
sad_refs: SAD-002#5.1, SAD-002#8.5
capabilities: CAP-pattern-nodes
---

# FEAT-015 — Patterns in the calculus

Express the `PATTERNS` set (`SAD-001#3.7`) as boolean DAG nodes consuming raw +
indicator levels, so price-action patterns compose in the same calculus as every
other node (SAD-002#8.5) while preserving the exact `evalPatternAt` truth values.

## Parent
EPIC-005

## Capabilities covered
- `CAP-pattern-nodes` (SAD-002#3.6) — each pattern (incl. multi-bar and
  `n`-parameterised) becomes a boolean node whose flag matches `evalPatternAt`
  bar-for-bar over the fixtures.

## Notes
- Create stories via `python workflow/tools/board.py new --capability <id> --parent FEAT-015`.
- Depends on the node model (FEAT-013) and the relational/algebraic kinds (FEAT-014);
  gates on the fidelity harness (FEAT-016).
