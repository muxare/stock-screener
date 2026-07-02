---
id: STORY-052
type: story
parent: FEAT-018
capability: CAP-eod-ingest
sad_refs: [SAD-003#3.2, SAD-003#2.2, SAD-003#8.8, SAD-003#5.2, SAD-003#6.2]
target: ~
estimate: ~
work_type: feature
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: 4157da61a7150f4330fde2aeb74bf393898dfd62
---

## User Story
As the operator, I want a daily post-close run that appends the latest bar(s) to
the Yahoo DB, so that I can re-run the screener each day on fresh data — and
re-running the same day never creates duplicate rows.

## Context
The daily-append run mode of the ingestion seam (`SAD-003#5.2`), the sibling of
the STORY-051 backfill. It fetches only what is new since the last stored bar and
appends through the same importer path. There is **no scheduler** (a non-goal):
the run is invoked by an external trigger (cron / manual). Idempotent upsert is
what makes both re-runs and interrupted backfills safe — resumability is "just
re-run" (SAD-003#8.8 / ADR-008).

## Acceptance Criteria
- [x] A daily run fetches bars **since the last stored bar** per ticker and
      appends them to the existing Yahoo DB via the same importer path as
      STORY-051 (`adjClose` → `bar.c`, unchanged schema).
- [x] Re-running the same day is **idempotent**: a second run produces **no
      duplicate rows** and overwrites same-date bars in place, via the importer's
      `ON CONFLICT(ticker, date)` upsert — verified by a test that runs the append
      twice and asserts row counts are unchanged on the second run (SAD-003#2.2).
- [x] The run is **externally triggered** — it builds no scheduler/cron/timer
      (SAD-003#1.2, SAD-003#8.8 / ADR-008); it is a single-shot CLI invocation.
- [x] An interrupted or partial run is recovered simply by **re-running** (no
      resume state file needed), because the upsert is idempotent (ADR-008).
- [x] The run targets the same documented Yahoo DB path as the backfill
      (SAD-003#6.2); it does not write over synthetic/golden fixtures.

## Architectural Constraints (from SAD)
- Reuse the STORY-051 ingest seam and the importer's idempotent upsert; do NOT add
  a second write path (SAD-003#5.2, SAD-003#2.2).
- Build **no scheduling infrastructure** — the trigger is external (SAD-003#1.2,
  SAD-003#8.8 / ADR-008).
- No engine/handler/port/schema change; serve through the existing
  `sqliteProvider` (SAD-003#2.1, SAD-003#8.7 / ADR-007).

## Out of scope
- The per-ticker network fetch primitive — STORY-050.
- The historical backfill run — STORY-051.
- Coverage/freshness reporting and the partial-failure threshold — STORY-053.
- A cron/timer/daemon or any scheduler (SAD-003#1.2).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- tools/yahoo-fetch/**
- package.json
