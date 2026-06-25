---
id: STORY-010
type: story
parent: FEAT-004
capability: CAP-search
sad_refs: [SAD#3.13, SAD#5.2, SAD#5.6]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want ticker/company search and quick-signal toggles so that I can jump to a name or apply a common signal fast.

## Acceptance Criteria
- [x] Ticker/company search returns expected names.
- [x] Quick-signal toggles (golden/death cross, MACD/Stoch crosses) inject the equivalent rule the POC injects.

## Architectural Constraints (from SAD)
- Quick-signal definitions come from the SAD#5.6 catalogue; injected rules use the SAD#5.1 engine kinds.

## Out of scope
- Nothing beyond the acceptance criteria.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/TopBar.tsx
- src/components/sidebar/QuickSignals.tsx
- src/store.ts
