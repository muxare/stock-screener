---
id: STORY-025
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#5.9, SAD#2.3, SAD#2.4]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: 993441bd1444dbad67e07b83723a4edf2f402b45
---

## User Story
As a trader, I want rapid rule changes and re-runs to never show stale or mismatched results so that the table, backtest, and selection always agree with the active screen.

## Context
From the STORY-018 code review (findings 4, 5, 6). Moving the screen and
backtest to async service calls removed the synchronous guarantees the old
in-browser compute had: results now race, streams overlap, and selection state
outlives the rows it pointed at. All three live in the client store (SAD#5.9).

## Acceptance Criteria
- [x] `runScreen()` is sequenced last-write-wins: when rule-set changes fire
      overlapping `/screen` requests, only the newest response is committed to
      `screen` (a slower earlier response can never overwrite a newer one).
      (finding 4 — `src/store.ts` `runScreen`)
- [x] `openBacktest()` is not re-entrant: starting a new backtest (or closing
      the modal mid-run) cancels/ignores any in-flight stream so a stale
      `.then` can never overwrite the current `backtestResult`/progress.
      (finding 5 — `src/store.ts` `openBacktest`/`closeBacktest`)
- [x] When the effective rule set changes, `selected` and `compareSel` are
      reconciled with the new result set: a selection that is no longer a match
      is cleared (or visibly reconciled) so detail/compare never show a name
      absent from the current screen. (finding 6 — `src/store.ts` reactive
      `runScreen`/subscription)
- [x] Tests cover: out-of-order `/screen` responses commit the newest only; a
      superseded backtest stream does not overwrite the current result; a
      rule change drops a now-absent selection.

## Architectural Constraints (from SAD)
- All of this lives in the SAD#5.9 client store; it is the single client-side
  source of truth. Do NOT add a second store or move sequencing into components.
- Sequencing must not regress the SAD#2.3 (screen ≤ 3s p95) / SAD#2.4 (backtest
  ≤ 30s) budgets — guard/cancel, don't serialize requests behind one another.
- Use a request token / generation counter or `AbortController`; do not rely on
  debounce timing as the correctness mechanism.

## Out of scope
- Surfacing per-name fetch failures in detail/compare (STORY-026).
- Reconnect/retry after a service outage at load (STORY-027).
- The bootstrap full-universe payload cleanup (`src/store.ts` `bootstrap`) —
  related but a separate efficiency finding.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/store.ts
- tests/**
