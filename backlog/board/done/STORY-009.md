---
id: STORY-009
type: story
parent: FEAT-004
capability: CAP-results
sad_refs: [SAD#3.9, SAD#5.2, SAD#5.9]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want results grouped by sector with a diff banner so that I can see what matched and what changed since my last screen.

## Acceptance Criteria
- [x] Matches are grouped by sector (rendered with @tanstack/react-table).
- [x] A session diff banner shows what changed vs the last screen, from a last-screen snapshot in the store.
- [x] Empty results show 'loosen a rule' guidance.

## Architectural Constraints (from SAD)
- Drive all data from the store (SAD#5.9); do NOT recompute the universe in the table; no second state store.

## Out of scope
- The not-investment-advice disclosure on this surface (STORY-022, SAD#2.7).

## Status
DONE — as-built in `Results.tsx` + `store.ts`.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/Results.tsx
- src/store.ts
