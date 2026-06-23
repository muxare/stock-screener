---
id: EPIC-003
type: epic
parent: ~
sad: SAD-001
sad_refs: SAD#4.2, SAD#4.3, SAD#5.7, SAD#5.10, SAD#6.1, SAD#2.2, SAD#2.3, SAD#2.4, SAD#2.5
capabilities: CAP-screen, CAP-backtest
---

# EPIC-003 — Production data & compute architecture

Replace the POC's two load-bearing fictions — the synthetic in-browser
generator and browser-only compute — with a `MarketDataProvider` port over
real, corporate-action-adjusted data and a server-side engine that screens and
backtests the full universe within budget.

## Goal
Full-universe screen returns within SAD#2.3 and a full-history backtest within
SAD#2.4, running on adjusted real bars (SAD#2.2) — without forking the engine
(SAD#2.5, SAD#2.6).

## Capabilities covered
- `CAP-screen` (SAD#3.1) — scale + data
- `CAP-backtest` (SAD#3.11) — scale

## Status note
**Not started.** All compute is in-browser today (`store.ts` calls
`M.generateUniverse` and `M.backtestRules` client-side). This epic is the
largest open architectural gap (SAD#8.3 ADR-003).

## Notes
- Features under this epic live in `backlog/features/FEAT-*.md` with `parent: EPIC-003`.
