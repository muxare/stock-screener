---
id: FEAT-007
type: feature
parent: EPIC-002
sad_refs: SAD#3.11, SAD#5.1, SAD#5.4, SAD#8.10
capabilities: CAP-backtest
---

# FEAT-007 — Backtesting

Walk every bar of every name and report forward returns at 5/10/20 horizons with
fire/win-rate stats, labelled naive (no costs/slippage/significance) per ADR-010.

## Parent
EPIC-002

## Capabilities covered
- `CAP-backtest` (SAD#3.11) — the engine + UI. Scaling it server-side lives in
  FEAT-009.

## Notes
- Create stories via `python3 workflow/tools/board.py new --capability <id> --parent FEAT-007`.
