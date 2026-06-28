---
id: STORY-051
type: story
parent: FEAT-018
capability: CAP-eod-ingest
sad_refs: [SAD-003#5.2, SAD-003#3.2, SAD-003#6.1, SAD-003#8.2, SAD-003#8.4, SAD-003#2.1, SAD-003#6.2]
target: ~
estimate: ~
work_type: feature
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As the operator, I want a backfill run that fetches a supplied ticker universe
over a historical range and lands it in a SQLite DB through the existing importer,
so that the app and screening service run against real Yahoo EOD bars exactly as
they run against synthetic data — with no engine, handler, or port change.

## Context
The fetch→import seam for SAD-003 (`SAD-003#5.2`), wiring the STORY-050 fetcher
into the existing `tools/eod-import` (STORY-031) and the `sqliteProvider`
(STORY-032) that serves the result. Per `ADR-002`, the fetcher **emits the
importer's CSV input** and runs the existing importer — it does NOT call the
importer's `db.ts` writer directly. `config.yahoo.json` already maps the expected
column shape (`Company` ticker column, `iso` dates, ignored Dividends/Stock
Splits).

## Acceptance Criteria
- [ ] A backfill run takes a **supplied ticker list** (config/file) + a historical
      range, fetches each via STORY-050, and **normalises rows into the importer's
      CSV input**, then runs `tools/eod-import` + `config.yahoo.json` to write the
      DB (SAD-003#8.2 / ADR-002).
- [ ] `bar.c` is set to Yahoo's **`adjClose`**; `o/h/l` are the raw open/high/low
      and `v` the raw volume, into the unchanged `instrument`/`bar` schema
      (SAD-003#6.1, SAD-003#8.4 / ADR-004). **No** corporate-action math is added.
- [ ] The written DB is opened and served by the **existing** `sqliteProvider`
      with **zero changes** to `provider.ts` / `sqlite.ts` / `market.ts` / the
      service handlers; pointing `MARKETDATA_DB` at the Yahoo DB runs the app/screen
      exactly as against synthetic (SAD-003#2.1).
- [ ] Name/sector are resolved via the importer's existing precedence (CSV column
      → metadata file → default), since the Yahoo response carries none.
- [ ] The Yahoo DB is written to a **stable, documented path** distinct from the
      synthetic and golden-master DBs (SAD-003#6.2); re-running the backfill is
      idempotent (upsert on `(ticker, date)`), adding no duplicate rows.
- [ ] Tests use recorded fetch fixtures (via STORY-050's injectable HTTP); no live
      network in CI (ADR-006).

## Architectural Constraints (from SAD)
- Reuse `tools/eod-import` + `config.yahoo.json`; emit the importer's CSV input —
  do NOT add a second DB-writing path that bypasses the importer's idempotent
  upsert (SAD-003#5.2, SAD-003#8.2 / ADR-002).
- No SQLite schema change and no new read adapter; serve through the existing
  `sqliteProvider` (SAD-003#1.2, SAD-003#8.7 / ADR-007). Editing `provider.ts` /
  `sqlite.ts` / `market.ts` / handlers is out of scope by definition (SAD-003#2.1).
- Map `c ← adjClose`; leave `o/h/l` raw; perform no corporate-action arithmetic.
  OHL-unadjusted-across-splits is the accepted, documented limitation
  (SAD-003#6.1, SAD-003#8.4 / ADR-004).

## Out of scope
- The per-ticker network fetch primitive — STORY-050.
- The daily post-close append mode (since-last-bar) — STORY-052.
- Coverage/freshness reporting and the partial-failure threshold — STORY-053.
- Persisting raw OHLCV + corporate-action events for future full-OHLC adjustment
  (reserved, not built — SAD-003#6.3, SAD-003#1.2).
- Any schema change or change to the importer's upsert semantics (SAD-003#1.2).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- tools/yahoo-fetch/**
- package.json
