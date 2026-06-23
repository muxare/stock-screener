---
id: STORY-017
type: story
parent: FEAT-009
capability: CAP-backtest
sad_refs: [SAD#4.2, SAD#5.7, SAD#2.4, SAD#2.5, SAD#8.3]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want full-universe backtests to run server-side so that a full-history backtest completes within budget without freezing the UI.

## Acceptance Criteria
- [ ] A backtest endpoint runs `backtestRules` over the full universe server-side.
- [ ] Full-universe + full-history backtest completes within ≤ 30s (SAD#2.4).
- [ ] The result is returned as a single summary payload (SAD#6.5).
- [ ] Long-running backtests report progress and never block the UI thread.

## Architectural Constraints (from SAD)
- Reuse the shared engine per SAD#8.3; honour the SAD#2.4 budget; rank rules stay excluded (SAD#3.8).

## Out of scope
- Client wiring (STORY-018).

## Status
TODO — not started. Backtest runs client-side today (`store.ts:910`).

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- server/**
- src/lib/market.ts
