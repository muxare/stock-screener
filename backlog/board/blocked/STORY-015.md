---
id: STORY-015
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#4.3, SAD#6.1, SAD#2.2, SAD#8.5, SAD#8.8]
target: ~
estimate: ~
attempts: 0
prev_column: todo
blocked_reason: ADR-008 market-data vendor decision + redistribution legal sign-off pending (SAD#8.8)
---

## User Story
As a trader, I want screens to run on real, corporate-action-adjusted market data so that the numbers match my charts and TC2000.

## Acceptance Criteria
- [ ] A real-data provider adapter implements the port (STORY-014).
- [ ] Bars are split/dividend adjusted at ingestion BEFORE the engine sees them (SAD#2.2 / ADR-005).
- [ ] A known split is reflected in the adjusted series (adjustment test).
- [ ] The vendor decision (ADR-008 / SAD#8.8) is recorded as accepted, with redistribution licensing sign-off, before this adapter ships.

## Architectural Constraints (from SAD)
- Adjustment is the data layer's responsibility per SAD#2.2; the engine never sees unadjusted closes.
- Blocked on ADR-008 vendor selection + legal sign-off (SAD#8.8).

## Out of scope
- Intraday/real-time streaming (SAD#1.2 — daily/EOD only in v1).

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- src/lib/data/**
- backlog/sad/SAD-001.md
