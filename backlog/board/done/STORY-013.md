---
id: STORY-013
type: story
parent: FEAT-007
capability: CAP-backtest
sad_refs: [SAD#3.11, SAD#5.1, SAD#5.4, SAD#8.10]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want to backtest a screen's forward returns so that I can judge whether a setup has had an edge.

## Acceptance Criteria
- [x] `backtestRules` walks every bar with a 30-bar warmup.
- [x] Forward returns at 5/10/20 horizons with fire rate, win rate, avg/median/best/worst.
- [x] Rank rules are excluded from the backtest.
- [x] Results carry the naive-fidelity label (ADR-010 / SAD#8.10).

## Architectural Constraints (from SAD)
- Backtest math stays in `market.ts`; the result label is mandatory per SAD#2.7/SAD#8.10.

## Out of scope
- Server-side full-universe scaling (STORY-017).
- Costs/slippage/significance rigor (deferred per ADR-010).

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/modals/BacktestModal.tsx
- src/lib/market.ts
- src/store.ts
