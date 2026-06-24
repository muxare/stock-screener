---
id: STORY-018
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#4.1, SAD#5.9, SAD#2.5]
target: ~
estimate: ~
attempts: 1
prev_column: in-progress
blocked_reason: Needs a per-displayed-name bar source. AC3 keeps detail/compare computing client-side, but retiring the full-universe build (AC2/SAD#2.5) removes the only bar source (st.universe); the service ScreenRow carries no bars and the server is out of 018's Touch scope. Prerequisite: a per-instrument bars provider/endpoint.
---

## User Story
As a trader, I want the client to use the screening service so that the browser stops computing the full universe.

## Acceptance Criteria
- [ ] The client calls the screening/backtest service for full-universe runs.
- [ ] In-browser full-universe compute (`M.generateUniverse` + full-universe `evalGroupedRules`/`backtestRules` in the store) is retired.
- [ ] The client still computes locally for detail/compare and small ad-hoc sets (single-name eval ≤ 50ms).
- [ ] The store reads results from the service via SAD#5.9 selectors.

## Architectural Constraints (from SAD)
- Per SAD#2.5 the browser must not compute the full universe; keep only displayed-name compute client-side.
- Do NOT add a second state store; route results through SAD#5.9.

## Out of scope
- Service implementation (STORY-016/017).

## Status
BLOCKED on STORY-024. Retiring the in-browser full-universe build (AC2 /
SAD#2.5) removes the only source of per-name bars (`st.universe`) that the
detail and compare panels read (`s.full.o/h/l/c/v`); the service `ScreenRow`
carries no bars and the server is outside this story's Touch scope. STORY-024
adds the per-displayed-name bar source (provider port `getInstrument` + service
endpoint). Once it lands, 018 becomes a pure client-wiring change: route
`screenList`/`openBacktest` through the service and fetch bars on demand for
displayed names only.

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- src/store.ts
- src/components/**
