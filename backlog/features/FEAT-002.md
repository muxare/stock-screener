---
id: FEAT-002
type: feature
parent: EPIC-001
sad_refs: SAD#3.2, SAD#3.3, SAD#5.3, SAD#5.6
capabilities: CAP-indicators, CAP-presets
---

# FEAT-002 — Indicator & preset authoring

Build custom indicators (EMA/SMA/RSI/MACD/Stoch-RSI over a chosen source) and
manage the strategy preset library — built-ins plus user create/edit/delete.

## Parent
EPIC-001

## Capabilities covered
- `CAP-indicators` (SAD#3.3)
- `CAP-presets` (SAD#3.2)

## Notes
- Create stories via `python3 tools/board.py new --capability <id> --parent FEAT-002`.
