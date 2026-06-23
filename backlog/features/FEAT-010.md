---
id: FEAT-010
type: feature
parent: EPIC-004
sad_refs: SAD#5.8, SAD#6.4, SAD#2.8, SAD#8.6
capabilities: CAP-presets
---

# FEAT-010 — Artifact persistence

Put user-authored artifacts (indicators, presets, named screens) behind a
repository interface with schema versioning, so the backing store can change
without touching feature code.

## Parent
EPIC-004

## Capabilities covered
- `CAP-presets` (SAD#3.2) — representative persisted artifact; the interface also
  serves indicators (CAP-indicators) and screens (CAP-screens).

## Notes
- Create stories via `python3 tools/board.py new --capability <id> --parent FEAT-010`.
