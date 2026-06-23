---
id: FEAT-008
type: feature
parent: EPIC-003
sad_refs: SAD#4.3, SAD#5.10, SAD#6.1, SAD#2.2, SAD#8.4, SAD#8.5, SAD#8.7, SAD#8.8
capabilities: CAP-screen
---

# FEAT-008 — Market data provider & adjustment

Introduce the `MarketDataProvider` port so the synthetic generator becomes a
dev/test-only adapter, and feed the engine real, corporate-action-adjusted daily
bars supplied at ingestion.

## Parent
EPIC-003

## Capabilities covered
- `CAP-screen` (SAD#3.1) — the data the engine screens over.

## Notes
- Create stories via `python3 tools/board.py new --capability <id> --parent FEAT-008`.
