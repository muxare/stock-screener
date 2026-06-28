---
id: STORY-050
type: story
parent: FEAT-018
capability: CAP-eod-fetch
sad_refs: [SAD-003#5.1, SAD-003#3.1, SAD-003#8.3, SAD-003#8.6, SAD-003#2.7, SAD-003#2.5]
target: ~
estimate: ~
work_type: feature
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As the operator, I want a Node/CLI fetcher that pulls a ticker's daily OHLCV
(plus adjusted close) from Yahoo Finance over a date range, so that I have a
reliable, testable source of real EOD bars to feed into the existing import
pipeline.

## Context
The fetch front-end for SAD-003 (`SAD-003#5.1`). It is the only new network
component; everything downstream of "bars on disk" is reused. This story builds
the **per-ticker fetch primitive** only — the universe-level run modes (backfill /
daily append) and the importer seam are STORY-051 / STORY-052, and coverage
reporting is STORY-053. Structure it like `tools/eod-import`: pure parse/normalise
functions plus a thin CLI that does I/O.

## Acceptance Criteria
- [ ] A function/CLI fetches one ticker's daily bars over a date range from the
      Yahoo **v8 `chart` JSON endpoint** using Node's built-in `fetch` — no
      third-party Yahoo wrapper as a runtime dependency (SAD-003#8.3 / ADR-003).
- [ ] The response is parsed into normalised daily rows carrying
      `date, open, high, low, close, adjClose, volume`, with `adjClose` returned
      **distinct from** raw `close` (the ingest seam maps `adjClose` → `bar.c`;
      that mapping is STORY-051, not here).
- [ ] The HTTP layer is **injectable**, so tests run against **recorded Yahoo
      responses** with **no live network call in CI** (SAD-003#8.6 / ADR-006).
- [ ] Fetching is **polite**: a configurable inter-request delay/batch size and a
      bounded **retry/backoff** on transient failures; a test asserts the backoff
      path on a simulated transient error (SAD-003#2.7).
- [ ] A ticker that ultimately fails to fetch surfaces a structured failure (with
      a reason) to the caller — it is **never silently dropped** (the run-level
      coverage policy consumes this; STORY-053).
- [ ] The module is **server/CLI-only** and never imported by client code; it
      checks in **no secret/credential** (SAD-003#2.5).

## Architectural Constraints (from SAD)
- All network I/O lives here (SAD-003#5.1); do NOT fetch at request time or inside
  the engine, and do not make the `MarketDataProvider` port async (SAD-003#1.2,
  SAD-003#2.6).
- Use the v8 `chart` JSON endpoint via built-in `fetch`; do NOT add a third-party
  Yahoo wrapper as a runtime dependency (SAD-003#8.3, SAD-003#2.5).
- Perform **no** corporate-action arithmetic — carry `adjClose` through as data;
  adjustment is trusted from the source (SAD-003#2.3 / ADR-004).
- Server/CLI-only; the fetcher must not enter the client bundle (SAD-003#2.5),
  mirroring the `node:sqlite` constraint on STORY-032.

## Out of scope
- Normalising rows into the importer's CSV input and writing the DB — STORY-051.
- The daily post-close append mode — STORY-052.
- Run-level coverage/freshness reporting and the partial-failure threshold —
  STORY-053.
- Any corporate-action math / full-OHLC back-adjustment (SAD-003#1.2, ADR-004).
- Universe discovery / index membership — the ticker list is supplied
  (SAD-003#1.2).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- tools/yahoo-fetch/**
- package.json
