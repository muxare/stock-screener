---
id: STORY-054
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#4.1, SAD#5.10, SAD#2.3]
target: ~
estimate: ~
work_type: feature
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As a trader, I want an on-demand `/instrument` fetch that never responds to time
out and surface as an error so that a hung connection shows a retryable error
instead of an unrecoverable spinner.

## Context
Fanned out of the STORY-026 code review (high-effort review, confirmed finding 1).
STORY-026 made the per-name fetch state visible: `ensureDisplayed` sets
`displayStatus[ticker] = 'loading'` and the detail panel / compare column render a
spinner. But `marketClient.instrument` issues a `fetch` with **no client-side
timeout**. If the service accepts the connection and never responds, the promise
never settles, the status stays `'loading'` forever, and the in-flight de-dup
guard (`ensureDisplayed` / `retryDisplayed` both bail while `'loading'`) blocks any
recovery — the user is stuck on a perpetual spinner until a full app reload.

This is a transport-resilience gap, not a per-name data error, so it sits outside
STORY-026's Touch scope (`marketClient.ts`). The same timeout-less `fetch` pattern
affects the other client calls (`screen`, `facts`, `backtest`); this story covers
`instrument` and may generalise the helper if it stays within Touch scope.

## Acceptance Criteria
- [ ] `marketClient.instrument` aborts and rejects after a bounded client-side
      timeout when the service accepts the connection but never responds
      (e.g. via `AbortController` / `AbortSignal.timeout`).
- [ ] A timed-out `/instrument` fetch surfaces through `ensureDisplayed` as
      `displayStatus[ticker] = 'error'` (the existing retryable error state), not a
      stuck `'loading'`.
- [ ] `retryDisplayed` re-requests the timed-out name and resolves it on success
      (the timeout path is indistinguishable from the existing error path to the UI).
- [ ] Tests cover a never-resolving `/instrument` fetch transitioning to `'error'`
      within the timeout and recovering on retry.

## Architectural Constraints (from SAD)
- All bar access goes through the `MarketClient` seam (SAD#4.1) over the
  market-data provider port (SAD#5.10); add the timeout inside that seam, not in
  the store or components.
- The detail/compare interactive budget is SAD#2.3 (single-name ≤ 50 ms local);
  the timeout bounds the *transport* wait, it does not change local compute.

## Out of scope
- Retry/backoff policy or reconnect-after-outage (STORY-027 covers load-time outage).
- Server-side request timeouts / handler changes (SAD#5.7) — client seam only.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/client/marketClient.ts
- src/store.ts                # only if the timeout error must be mapped in ensureDisplayed
- tests/**
