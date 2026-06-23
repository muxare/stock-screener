---
id: STORY-005
type: story
parent: FEAT-001
capability: CAP-rank
sad_refs: [SAD#3.8, SAD#5.1, SAD#5.6]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want top/bottom percentile ranking so that I can screen relative strength across the universe or within a sector.

## Acceptance Criteria
- [x] Top/bottom percentile by a field, across the whole universe or within each sector, via `rankPassSet`.
- [x] `RANK_FIELDS` catalogue (SAD#5.6) drives the field choices.
- [x] Rank rules are excluded from backtests (matches POC).

## Architectural Constraints (from SAD)
- Ranking lives in `market.ts`; the backtest path must continue to exclude rank rules per SAD#3.8.

## Out of scope
- Automated parity tests (STORY-020).

## Status
DONE — as-built in `market.ts` + sidebar; backtest exclusion honoured in `store.ts`.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/lib/market.ts
- src/store.ts
- src/components/sidebar/FilterSections.tsx
