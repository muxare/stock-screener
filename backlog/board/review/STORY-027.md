---
id: STORY-027
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#5.9, SAD#4.1, SAD#4.2]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: 471999a3a634bea87502d8ca09abbf68543c500c
---

## User Story
As a trader, I want the app to recover once the screening service becomes reachable so that a service that was down at load doesn't leave a permanently empty app.

## Context
From the STORY-018 code review (findings 9, 10). If the service is unreachable
at boot, the app is stuck: `runScreen` sets the "service unavailable" banner and
`bootstrap` leaves `universeSize` 0 / no sectors, and nothing re-runs until the
active rule set happens to change. The only manual re-trigger (the Top-bar
Refresh button) was removed in STORY-018. Separately, the indicator-builder
sample preview depends on a single boot fetch with no retry, so it stays blank
for the whole session if that one fetch failed.

## Acceptance Criteria
- [x] There is a path to recover after a service outage at load: when the
      service becomes reachable the app re-runs the screen and re-fetches the
      universe facts (sector list, total) — via an explicit retry affordance on
      the unavailable banner and/or automatic re-attempt. The app must not stay
      empty until an unrelated rule edit. (finding 9 — `src/store.ts`
      `runScreen`/`bootstrap`, banner surface)
- [x] The offline/unavailable state is communicated with a way to retry; a
      successful retry clears the banner and populates rows, "of N", and sectors.
- [x] The indicator-builder sample preview recovers: if the boot `sampleStock`
      fetch failed, the preview retries (or lazy-fetches when the builder opens)
      rather than showing "—" for the rest of the session. (finding 10 —
      `src/store.ts` `bootstrap`, `src/components/modals/IndicatorBuilderModal.tsx`)
- [x] Tests cover: service unavailable at init then reachable → retry populates
      screen + facts; sample preview recovers after an initial failure.

## Architectural Constraints (from SAD)
- The client talks to the service over same-origin HTTP/JSON (SAD#4.1 ↔ SAD#4.2);
  retry is a client concern in the SAD#5.9 store — do not add a second store.
- Keep full-universe compute server-side (SAD#2.5): recovery re-fetches from the
  service; it must not reintroduce an in-browser universe build.
- A reseed/new-session capability is explicitly NOT in scope here (it needs a
  server-side affordance, noted as STORY-018 follow-up) — recovery means
  re-fetching current service state, not regenerating data.

## Out of scope
- Store request-sequencing / re-entrancy (STORY-025).
- Per-name detail/compare fetch affordances (STORY-026).
- A server-side reseed / "new session" feature (separate follow-up).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/store.ts
- src/components/** (banner/retry surface, IndicatorBuilderModal)
- tests/**
