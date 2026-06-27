---
id: STORY-037
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#4.3, SAD#1.2]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As a user loading the production app, I don't want a guaranteed-404 request to
the DEV_TOOLS-gated `/dev/import/options` on every startup, so page load doesn't
waste a round-trip that can never succeed.

## Context
Found during STORY-035 code review (pre-existing in `init()`, untouched by that
story). `init()` unconditionally calls `probeDevImport()`, which fetches
`/dev/import/options`. In production DEV_TOOLS is off by design, so this 404s on
every load. The probe should be gated behind a build-time dev flag (e.g.
`import.meta.env.DEV`) so it only fires in dev builds where the dev-import
tooling actually exists.

## Acceptance Criteria
- [ ] `probeDevImport()` is not invoked from `init()` in production builds (gate
      on `import.meta.env.DEV` or equivalent build-time flag).
- [ ] Dev builds still probe and surface the dev-import UI exactly as today.
- [ ] No change to the `MarketClient` seam.

## Out of scope
- Removing the server-side DEV_TOOLS gate (the 404 stays correct server-side).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/store.ts
- src/store.test.ts
