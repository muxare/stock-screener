---
id: FEAT-009
type: feature
parent: EPIC-003
sad_refs: SAD#4.2, SAD#4.1, SAD#5.7, SAD#5.9, SAD#2.3, SAD#2.4, SAD#2.5, SAD#8.3
capabilities: CAP-screen, CAP-backtest
---

# FEAT-009 — Server-side screening & backtest

Host the shared `src/lib/market.ts` engine in a Node service that screens and
backtests the full universe within budget, and wire the client to call it
instead of computing the full universe in the browser.

## Parent
EPIC-003

## Capabilities covered
- `CAP-screen` (SAD#3.1) — full-universe screen path.
- `CAP-backtest` (SAD#3.11) — full-universe backtest path.

## Notes
- Create stories via `python3 tools/board.py new --capability <id> --parent FEAT-009`.
