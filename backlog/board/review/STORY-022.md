---
id: STORY-022
type: story
parent: FEAT-012
capability: CAP-results
sad_refs: [SAD#2.7]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: ee2e5e4efbd80385b77d4142b10ce5199b158d18
---

## User Story
As a user, I want a not-investment-advice disclosure on every signal surface so that the product's compliance posture is consistent.

## Acceptance Criteria
- [x] A shared disclosure component exists.
- [x] It is rendered on the results and detail surfaces (the backtest modal already has it).
- [x] Backtest results remain labelled naive/illustrative.
- [x] No signal-bearing surface ships without the disclosure (SAD#2.7).

## Architectural Constraints (from SAD)
- SAD#2.7 requires the disclosure on every signal surface; centralise it in one component, do not copy strings.

## Out of scope
- Nothing beyond the acceptance criteria.

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- src/components/**
