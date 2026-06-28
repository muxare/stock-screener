---
id: STORY-053
type: story
parent: FEAT-019
capability: CAP-eod-coverage
sad_refs: [SAD-003#5.3, SAD-003#3.3, SAD-003#2.4, SAD-003#8.5]
target: ~
estimate: ~
work_type: feature
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: 740fbe77c850faae04dc07f5b8e41806c5c735d6
---

## User Story
As the operator, I want every fetch run to report coverage and freshness and to
fail loudly when it falls short, so that a run can never silently drop names and
I always know how much of my universe is current.

## Context
The reporting + partial-failure guardrail for SAD-003 (`SAD-003#5.3`). It
consumes the per-ticker fetch outcomes (success / structured failure from
STORY-050) produced during a backfill (STORY-051) or daily append (STORY-052) and
turns them into a first-class run output. The driving rule from the plan: **"a run
that silently drops names is a failure."**

## Acceptance Criteria
- [x] Every run emits a **structured + printable report** listing each requested
      ticker as fetched or failed, with a **reason** for each failure (SAD-003#2.4).
- [x] The report includes **coverage** — % of the target universe fetched
      successfully — and **freshness** — max staleness (newest written bar date vs
      the last trading day) after the run (SAD-003#2.4).
- [x] On partial failure the run **commits the successfully-fetched set** rather
      than discarding the whole run (SAD-003#8.5 / ADR-005).
- [x] The run **exits non-zero** when coverage falls below a **configurable
      threshold**, so automation can gate on it (SAD-003#8.5 / ADR-005).
- [x] A test with some tickers failing asserts: the rest are committed, every
      failure is named in the report with a reason, coverage/max-staleness are
      correct, and the exit code reflects the threshold. A silently-dropped name is
      a test failure (SAD-003#2.4).

## Architectural Constraints (from SAD)
- The coverage/freshness report is a first-class run output, not log-only; never
  emit an aggregate that hides which names were dropped (SAD-003#5.3, SAD-003#2.4).
- Partial-failure policy is commit-partial + report + threshold exit; do NOT fail
  the whole run on a few bad tickers, and do NOT silently succeed (SAD-003#8.5 /
  ADR-005).
- Derive freshness from the newest written bar date vs the last trading day
  (SAD-003#5.3).

## Out of scope
- The network fetch primitive and its per-ticker failure surfacing — STORY-050.
- The backfill and daily-append run mechanics — STORY-051 / STORY-052.
- Retry/backoff policy itself (this story reports the give-up outcome; the backoff
  lives in STORY-050 / SAD-003#2.7).
- Any data-quality validation beyond fetch success/failure (no gap detection or
  outlier scrubbing).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- tools/yahoo-fetch/**
- package.json
