---
id: STORY-028
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#5.7, SAD#5.9, SAD#2.3]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: 8d235273d42406c8454121c3c44cd93cf7cd3c13
---

## User Story
As an engineer, I want bootstrap to fetch only the universe facts it needs (count + sectors) so that app load doesn't download a full-universe row payload just to derive a sector list and total.

## Context
From the STORY-018 code review (CONFIRMED efficiency finding, lower priority).
`bootstrap()` calls `apiScreen([], ALL_ROWS)` purely to derive `universeSize`
and the sector list, then discards every row. That pulls a full `ScreenRow[]`
for the whole universe on every app load — each row carrying ~13 scalars plus a
40-element sparkline — when only the total and the distinct sector set are used.

## Acceptance Criteria
- [x] `bootstrap()` no longer requests full row payloads to derive universe
      facts: the total and sector list come from a count/facets-only response,
      not an `ALL_ROWS` screen. (`src/store.ts` `bootstrap`)
- [x] The service exposes the universe count + sector facets without serialising
      per-name rows (e.g. extend the SAD#5.7 `/screen` projection or a dedicated
      facets shape); the sparkline/scalar row payload is not sent for this call.
- [x] App load still shows the correct "of N" total and sector facets — covered
      by the existing client integration test, which must stay green.
- [x] No behaviour change to the main `/screen` results path (still returns full
      rows for the active rule set).

## Architectural Constraints (from SAD)
- Keep full-universe work server-side (SAD#2.5); this is a payload-shape change,
  not a move of compute.
- Derive facts via the SAD#5.7 service handlers; the client reads them into the
  SAD#5.9 store as today — do not compute sectors/total in the browser.
- Stay within the SAD#2.3 budget; the goal is less bytes on the wire, not new
  latency.

## Out of scope
- The reactive `/screen` results projection that feeds the table (unchanged).
- Any other bootstrap concern (sample-name fetch recovery is STORY-027).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/store.ts
- server/screen.ts
- server/**
- tests/**
