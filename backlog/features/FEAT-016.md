---
id: FEAT-016
type: feature
parent: EPIC-005
sad_refs: SAD-002#5.4, SAD-002#5.5, SAD-002#2.1
capabilities: CAP-dag-compat, CAP-dag-fidelity
---

# FEAT-016 — Compatibility & fidelity gate

The two guarantees that make the in-place refactor safe (SAD-002#8.2): a
backward-compatible public surface — `indSeries`, the `eval*` functions,
`backtestRules`, `PRESETS`, the catalogues — re-implemented over the new model
with unchanged signatures (SAD-002#5.4, #2.3), and a **differential fidelity
harness** that diffs old-engine vs new-engine output bar-for-bar across every
indicator, every preset, and the PCF example, gating CI (SAD-002#5.5, #2.1).

## Parent
EPIC-005

## Capabilities covered
- `CAP-dag-compat` (SAD-002#3.7) — preserved exported API; no consumer/store edits.
- `CAP-dag-fidelity` (SAD-002#3.8) — CI-gating differential harness over the
  golden-master fixtures.

## Notes
- Create stories via `python workflow/tools/board.py new --capability <id> --parent FEAT-016`.
- The fidelity harness is cross-cutting (SAD-002#7): every lowering/evaluation
  story in EPIC-005 runs it. Stand it up early against the *old* engine so parity
  is provable as each piece lands.
