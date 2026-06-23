---
id: STORY-021
type: story
parent: FEAT-011
capability: CAP-screen
sad_refs: [SAD#2.3, SAD#2.4, SAD#5.7]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
---

## User Story
As an engineer, I want latency instrumentation so that screen/backtest performance is measured against the SAD budgets.

## Acceptance Criteria
- [ ] The screen path emits latency metrics checked against SAD#2.3 (p95 ≤ 3s).
- [ ] The backtest path emits latency metrics checked against SAD#2.4 (≤ 30s).
- [ ] Budget regressions are visible (logged/asserted).

## Architectural Constraints (from SAD)
- Instrument the SAD#5.7 service path; budgets are SAD#2.3/SAD#2.4.

## Out of scope
- The service itself (STORY-016/017).

## Status
TODO — not started; unmeasurable until the service exists.

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- server/**
- src/store.ts
- tests/**
