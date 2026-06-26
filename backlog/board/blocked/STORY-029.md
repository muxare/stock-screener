---
id: STORY-029
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#4.2, SAD#4.3, SAD#5.10, SAD#5.9]
target: ~
estimate: ~
attempts: 0
prev_column: todo
blocked_reason: product decision pending: reseed/new-session affordance — confirm with product owner it's still wanted before building (SAD open question, STORY-018 follow-up)
---

## User Story
As a trader, I want a server-side new-session / reseed control so that I can refresh to a new market scenario without the browser regenerating data (restoring the affordance the removed Top-bar Refresh provided).

## Context
STORY-018 follow-up. The old Top-bar "Refresh" reseeded the synthetic universe
**client-side** (`seed+1`) and drove the session-diff banner / screen alerts.
That became impossible once data lives on the seed-pinned service, so Refresh,
`refreshData`, and the diff banner were removed. The product owner left an open
question: provide a **server-side** reseed/new-session instead, if the affordance
is still wanted.

> ⚠ PRODUCT DECISION PENDING — confirm with the product owner that a reseed/
> new-session affordance is still wanted before building. If it is dropped,
> close this story as won't-do. The acceptance criteria below assume it is in.

## Acceptance Criteria
- [ ] The service can advance to a new session (reseed the synthetic universe)
      behind the `MarketDataProvider` port (SAD#5.10) — e.g. a `/session`/reseed
      endpoint on the SAD#4.2 service that rebuilds the warm universe
      (`server/universe.ts`) with a new seed.
- [ ] A client affordance (replacing the removed Refresh) triggers the new
      session and re-runs the screen + re-fetches universe facts so the table,
      counts, sectors, and any displayed names reflect the new scenario.
- [ ] Reseeding invalidates client caches that are now stale (`displayed`,
      `rankTickers`, preset/screen counts) so no pre-reseed data lingers.
- [ ] (If the session-diff banner / screen alerts are wanted back, scope that
      explicitly — otherwise it stays removed.)
- [ ] Tests cover: reseed changes the universe the service screens against, and
      the client reflects the new session after triggering it.

## Architectural Constraints (from SAD)
- Reseed happens server-side through the SAD#5.10 provider port and the
  SAD#4.3 data store — the browser must NOT regenerate or compute the universe
  (SAD#2.5). The synthetic generator stays out of client code.
- The synthetic adapter is dev/test only (SAD#1.2 / SAD#5.10); a real-vendor
  universe (STORY-015) would not reseed this way — keep the reseed behind the
  port so it is a no-op/absent for non-synthetic adapters.
- Client state flows through the SAD#5.9 store; no second store.

## Out of scope
- Real-vendor data (STORY-015) and the ADR-008 vendor decision.
- Restoring the session-diff banner unless product explicitly asks (note above).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- server/universe.ts
- server/index.ts
- server/handlers.ts
- src/store.ts
- src/components/** (TopBar affordance)
- tests/**
