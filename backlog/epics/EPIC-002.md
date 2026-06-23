---
id: EPIC-002
type: epic
parent: ~
sad: SAD-001
sad_refs: SAD#3, SAD#5.2, SAD#5.4, SAD#5.5, SAD#5.9
capabilities: CAP-results, CAP-search, CAP-detail, CAP-compare, CAP-backtest
---

# EPIC-002 — Results, detail & analysis surfaces

Turn a screen run into insight: sector-grouped results with a session diff,
ticker/quick-signal discovery, an interactive detail chart with per-rule
explainability, side-by-side comparison, and backtesting of forward returns.

## Goal
From a screen run, a trader can see which names matched and why, confirm a name
on a chart carrying the screen's overlays, compare names, and backtest the
screen — reproducing the POC surfaces (SAD#1.1, SAD#3.9–3.13).

## Capabilities covered
- `CAP-results` (SAD#3.9)
- `CAP-search` (SAD#3.13)
- `CAP-detail` (SAD#3.10)
- `CAP-compare` (SAD#3.12)
- `CAP-backtest` (SAD#3.11)

## Status note
As-built in `src/`. Backtest currently runs **client-side** over the demo
universe; scaling it server-side is tracked under EPIC-003 / FEAT-009.

## Notes
- Features under this epic live in `backlog/features/FEAT-*.md` with `parent: EPIC-002`.
