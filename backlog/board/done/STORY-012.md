---
id: STORY-012
type: story
parent: FEAT-006
capability: CAP-compare
sad_refs: [SAD#3.12, SAD#5.4, SAD#5.9]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want to compare names side-by-side so that I can choose between candidates.

## Acceptance Criteria
- [x] A compare bar and drawer render selected names side-by-side with consistent overlays.
- [x] Compare selection persists within a session via the store.

## Architectural Constraints (from SAD)
- Selection lives in the SAD#5.9 store; do NOT add a second state store.

## Out of scope
- Nothing beyond the acceptance criteria.

## Status
DONE — as-built in `compare/Compare.tsx` + `store.ts`.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/compare/Compare.tsx
- src/store.ts
