---
id: STORY-055
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
As a user loading the screener, I want the `screen` and `facts` service calls to
fail with a bounded, retryable error when the service accepts the connection but
never responds, so a hung connection surfaces as a recoverable error instead of an
indefinitely-pending request.

## Context
Fanned out of the STORY-054 code review (confirmed out-of-scope finding). STORY-054
bounded the on-demand `/instrument` fetch with a client-side `AbortSignal.timeout`.
The same timeout-less `fetch` pattern remains in `marketClient.screen` and
`marketClient.facts`: both take an optional external `AbortSignal` from the store's
generation-based sequencing, but nothing bounds the *transport* wait, so a service
that accepts the connection and never responds leaves the call pending until the
caller happens to supersede it.

This is the sibling transport-resilience gap to STORY-054, scoped to the
non-streaming JSON calls. It is genuinely the same root cause as STORY-054
(timeout-less `fetch`) but sits outside STORY-054's Touch scope, hence a new story
rather than a silent widening.

## Acceptance Criteria
- [ ] `marketClient.screen` aborts and rejects after a bounded client-side timeout
      when the service accepts the connection but never responds, composed with any
      externally-supplied `AbortSignal` (e.g. `AbortSignal.any([external, timeout])`)
      so caller-driven cancellation still works.
- [ ] `marketClient.facts` gets the same bounded timeout, composed with its
      external `AbortSignal`.
- [ ] A timed-out `screen`/`facts` surfaces through the store's existing error
      path (the `screenError` banner / facts failure handling), not a stuck
      pending state.
- [ ] Tests cover a never-resolving `screen` and `facts` fetch rejecting within the
      timeout, and confirm an externally-aborted call still cancels as before.

## Architectural Constraints (from SAD)
- All service calls go through the `MarketClient` seam (SAD#4.1) over the
  market-data provider port (SAD#5.10); add the timeout inside that seam.
- The timeout bounds the *transport* wait; it does not change the SAD#2.3 screen
  latency budget (p95 ≤ 3 s warm-cache), so the transport ceiling must be safely
  above that budget.

## Out of scope
- `marketClient.backtest` — it is an NDJSON progress stream with a much larger
  budget (SAD#2.4, ≤ 30 s) and already emits `progress` lines; a stall there is
  better detected by a progress-gap watchdog than a blanket request timeout. That
  is its own design decision and its own story.
- `marketClient.instrument` — already bounded by STORY-054.
- Retry/backoff or reconnect-after-outage policy (STORY-027 covers load-time
  outage).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/client/marketClient.ts
- tests/**
