---
id: FEAT-014
type: feature
parent: EPIC-005
sad_refs: SAD-002#5.3, SAD-002#5.1, SAD-002#8.4
capabilities: CAP-dag-lower, CAP-algebra, CAP-relational
---

# FEAT-014 — Lowering & first-class operators

The single shared lowering path that maps existing `IndicatorDef`s, rule operands
(`group`/`chain`/`cond`/`ind`, with bar offsets and `×mult/+add`) and `parsePCF`
output onto DAG nodes (SAD-002#5.3), together with the first-class **algebraic**
(`+ − × ÷`) and **relational/boolean** (`> < ≥ ≤ == !=`, `cross_*`) node kinds
the lowering targets (SAD-002#8.4). One arithmetic/comparison implementation, not
two — the operators are nodes and the old per-operand math lowers into them.

## Parent
EPIC-005

## Capabilities covered
- `CAP-dag-lower` (SAD-002#3.2) — lower indicators, rule operands, and PCF to nodes
  through one path; offsets and arithmetic preserved exactly.
- `CAP-algebra` (SAD-002#3.4) — `+ − × ÷` combinator nodes over scalar series.
- `CAP-relational` (SAD-002#3.5) — comparison and `cross_up`/`cross_down` boolean nodes.

## Notes
- Create stories via `python workflow/tools/board.py new --capability <id> --parent FEAT-014`.
- Build order: algebraic + relational node kinds land before / alongside lowering,
  since lowering targets them. All three gate on the fidelity harness (FEAT-016).
