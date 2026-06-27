---
id: STORY-038
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#5.9, SAD#5.7, SAD#2.6]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As a developer, I want the `/screen` wire-row shape and the dev-import DTOs
defined once and shared between the client `MarketClient` and the server, so a
column added server-side forces a compile error (not a silent blank column)
client-side.

## Context
Found during STORY-035 code review. The new `Row` interface in
`src/lib/client/marketClient.ts` is a field-for-field copy of `ScreenRow` in
`server/screen.ts`, and the dev-import DTOs (`ImportConfigOption`,
`ImportDataEntry`, `ImportOptionsResp`, `DevImportRequest`, `DevImportReport`)
mirror those in `server/devImport.ts`. There is no compile-time link, and
`res.json() as Promise<ScreenResp>` is an unchecked cast — so when the server
emits a new scalar the client type silently omits it and the new results-table
column renders blank until someone hand-syncs the second copy. STORY-035 left
this as-is because the fix touches `server/` and `src/lib/market.ts`, both
outside its Touch scope.

## Acceptance Criteria
- [ ] The `/screen` wire-row type has a single definition imported by both the
      client seam and `server/screen.ts` (e.g. in the isomorphic
      `src/lib/market.ts`, respecting SAD#2.6 — no DOM/fetch added there).
- [ ] The dev-import wire DTOs have a single shared definition imported by both
      `src/lib/client/marketClient.ts` and `server/devImport.ts`.
- [ ] No behavioural change; `tsc` is clean and the full test suite passes.

## Out of scope
- Adding runtime response validation (the unchecked `as` cast can stay; this
  story is about a single compile-time source of truth).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/market.ts
- src/lib/client/marketClient.ts
- server/screen.ts
- server/devImport.ts
- src/store.ts
