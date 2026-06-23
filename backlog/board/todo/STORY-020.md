---
id: STORY-020
type: story
parent: FEAT-011
capability: CAP-screen
sad_refs: [SAD#2.1, SAD#8.2, SAD#5.1]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
---

## User Story
As an engineer, I want a golden-master fidelity harness so that any divergence from POC numbers fails CI.

## Acceptance Criteria
- [ ] A test runner is configured in the project.
- [ ] Golden-master fixtures pin `ema`/`sma`/`rsi`/`stochRsi`/`macd`, `evalGroupedRules`, `parsePCF`, and `backtestRules` output to POC values bar-for-bar over a fixed series.
- [ ] Any divergence fails CI (SAD#2.1).
- [ ] The deterministic fixture series comes from the synthetic test adapter (STORY-014).

## Architectural Constraints (from SAD)
- This enforces SAD#2.1, the top-priority quality attribute; tests pin the SAD#5.1 engine exactly per ADR-002.

## Out of scope
- Nothing beyond the acceptance criteria.

## Status
TODO — not started. There are no tests in the repo today.

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- package.json
- tests/**
- src/lib/**
