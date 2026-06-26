---
id: STORY-030
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#4.1, SAD#4.2, SAD#5.9]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engineer, I want the dev proxy to cover every same-origin service path the
client fetches, so that adding a new service endpoint can't silently work in
tests but break in the browser.

## Context
STORY-028 (`/facts`) and STORY-021 (`/metrics`) added same-origin endpoints but
left `vite.config.ts`'s proxy forwarding only `/screen`, `/backtest`,
`/instrument`. In the browser those new paths hit Vite's SPA fallback (HTTP 200
`text/html`), so `apiFacts()` parsed HTML, threw, and `bootstrap()` left
`universeSize` 0 with no sectors. The client-integration tests missed it entirely
because the harness rewrites `globalThis.fetch` to hit the in-process server
directly (`tests/store.client.test.ts`), bypassing the Vite proxy. The proxy was
patched reactively (commit `fix(dev): proxy /facts and /metrics`); this story
makes the gap impossible to reintroduce.

## Acceptance Criteria
- [ ] A test enumerates the same-origin paths the client store fetches (the
      `fetch('/…')` literals in `src/store.ts`: `/screen`, `/backtest`,
      `/instrument`, `/facts`, `/metrics`) and asserts each has a matching entry
      in the `vite.config.ts` dev `server.proxy` map.
- [ ] The test fails if a new client-fetched same-origin path is added to the
      store without a corresponding proxy entry (i.e. it is derived from the
      store, not a hard-coded duplicate list that drifts).
- [ ] Removing any current proxy entry makes the test red (proven once during
      implementation).

## Architectural Constraints (from SAD)
- The client talks to the SAD#4.2 service over same-origin HTTP/JSON (SAD#4.1);
  every such path must be reachable in dev via the proxy. This is a dev-tooling
  guard, not a runtime behaviour change — do not move fetches out of the SAD#5.9
  store or change the production same-origin contract.
- Keep it a static/build-time check (parse the source / import the config); do
  not require a live Vite server or a running service to run the test.

## Out of scope
- Production serving / reverse-proxy config (dev-proxy only).
- Adding new endpoints or changing existing handler behaviour.
- Asserting the proxy *target* is correct beyond "an entry exists".

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- tests/**
- vite.config.ts
