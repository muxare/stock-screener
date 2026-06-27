---
id: STORY-036
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#4.3, SAD#6.1]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As a developer running a dev EOD import, I want a 2xx response whose body fails
to parse to surface as an error, so a truncated/garbage success body never shows
a blank "import succeeded" summary.

## Context
Found during STORY-035 code review (faithfully carried over from the original
`apiDevImport`). `httpMarketClient.devImport` parses the body with
`res.json().catch(() => ({}))` for BOTH the error and success paths, so an OK
response with a malformed/empty JSON body silently returns `{}` cast as
`DevImportReport`. `runDevImport` then stores an all-undefined report and runs
`bootstrap()+runScreen()` as if the import succeeded — the user sees a
blank/garbage summary with no error. STORY-035 deliberately did NOT change this
(its AC mandated identical transport behaviour); this story fixes the latent bug.

## Acceptance Criteria
- [ ] `httpMarketClient.devImport` throws (rather than returning `{}`) when a 2xx
      response body cannot be parsed as JSON.
- [ ] The existing error-path behaviour is unchanged: `!res.ok` still throws the
      service-provided `error` message, falling back to `import failed: <status>`.
- [ ] A test covers the malformed-2xx-body case.

## Out of scope
- Any change to the screen/instrument/facts/backtest methods.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/client/marketClient.ts
- src/lib/client/marketClient.test.ts
