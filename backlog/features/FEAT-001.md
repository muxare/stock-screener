---
id: FEAT-001
type: feature
parent: EPIC-001
sad_refs: SAD#3.1, SAD#3.4, SAD#3.6, SAD#3.7, SAD#3.8, SAD#5.1, SAD#5.3
capabilities: CAP-screen, CAP-setups, CAP-screens, CAP-patterns, CAP-rank
---

# FEAT-001 — Screening engine & composable rules

The rule engine and the builders that author its rule kinds: AND/OR grouped
conditions with bar offsets and arithmetic, ordered comparison chains,
price-action patterns, and cross-sectional ranking.

## Parent
EPIC-001

## Capabilities covered
- `CAP-screen` (SAD#3.1)
- `CAP-setups` (SAD#3.4)
- `CAP-screens` (SAD#3.6)
- `CAP-patterns` (SAD#3.7)
- `CAP-rank` (SAD#3.8)

## Notes
- Create stories via `python3 workflow/tools/board.py new --capability <id> --parent FEAT-001`.
