---
id: STORY-002
type: story
parent: FEAT-001
capability: CAP-setups
sad_refs: [SAD#3.4, SAD#5.3, SAD#5.1]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want to build condition groups of pairwise comparisons with bar offsets and arithmetic so that I can express multi-condition setups.

## Acceptance Criteria
- [x] Pairwise comparisons combine with AND/OR.
- [x] Each operand carries a bar offset (t−1, t−2…) and optional ×mult/+add arithmetic.
- [x] Cross-up / cross-down operators are supported.
- [x] Groups evaluate via `evalGroupAt`/`evalCondAt`, authored in `ScreenBuilderModal`.

## Architectural Constraints (from SAD)
- Builder UI per SAD#5.3 produces rule objects the SAD#5.1 engine consumes unchanged; do NOT fork condition evaluation into the component.

## Out of scope
- Automated parity tests (STORY-020).

## Status
DONE — as-built in `src/components/modals/ScreenBuilderModal.tsx` + `market.ts`.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/modals/ScreenBuilderModal.tsx
- src/lib/market.ts
