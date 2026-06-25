---
id: STORY-023
type: story
parent: FEAT-012
capability: CAP-detail
sad_refs: [SAD#2.9, SAD#5.4]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
---

## User Story
As a keyboard user, I want the detail chart to be operable without a pointer so that the app meets its accessibility posture.

## Acceptance Criteria
- [ ] Detail chart pan/zoom/reset have non-pointer (keyboard) fallbacks (SAD#2.9).
- [ ] Chart controls are focusable and labelled.

## Architectural Constraints (from SAD)
- Accessibility per SAD#2.9; changes stay within the SAD#5.4 detail components.

## Out of scope
- Builder-modal accessibility (tracked with each builder story).

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- src/components/detail/StockDetail.tsx
