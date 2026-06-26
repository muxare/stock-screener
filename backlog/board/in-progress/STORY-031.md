---
id: STORY-031
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#4.3, SAD#6.1, SAD#1.2, SAD#8.7]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
reject_reason: ~
base_commit: 3028405992a66799e67f84f19f7c060fd0acc9e5
---

## User Story
As an engineer, I want a command that ingests CSV files of end-of-day OHLCV data
into a SQLite database so that development and testing can run against
real-shaped historical data instead of the synthetic generator.

## Context
Refined from IDEA-001 / PLAN-002. This is the **writer** half of a dev/test data
seam (the read-side adapter is STORY-032). It is a sibling to the synthetic
adapter (STORY-014) on the same `MarketDataProvider` port — NOT the licensed
vendor path (STORY-015, blocked on ADR-008). Decisions locked in PLAN-002:
dev/test only, **bars assumed pre-adjusted** (no split/dividend math), and a
**configurable column mapping** so Stooq/Yahoo/broker CSVs all load.

## Acceptance Criteria
- [ ] A single command reads one or more CSV files of daily OHLCV rows and writes
      a SQLite DB at a configurable output path.
- [ ] The SQLite schema matches SAD#6.1: an `instrument` table (`ticker`, `name`,
      `sector`) and a `bar` table (`ticker`, `date`, `o`, `h`, `l`, `c`, `v`)
      with a uniqueness constraint / primary key on (`ticker`, `date`).
- [ ] Column mapping is configurable (which columns are date / open / high / low
      / close / volume / ticker, plus date format and ticker normalization), so a
      new source is onboarded by editing config — **no code change**.
- [ ] Both layouts load: multiple tickers in one file, and one file per ticker
      (ticker taken from a mapped column or, when absent, the filename).
- [ ] Re-running the import on the same input is **idempotent**: upsert on
      (`ticker`, `date`) — no duplicate instruments or bars.
- [ ] Malformed / blank rows are reported (count + a small sample) and skipped;
      one bad row never aborts the whole run.
- [ ] `sector` resolution is explicit: from a mapped CSV column if present, else
      from an optional side metadata file, else stored as `'Unknown'` (never
      silently empty). `name` falls back to `ticker` when absent.
- [ ] Importing a realistic multi-year, multi-hundred-ticker dataset completes in
      a dev-acceptable time (seconds) — verified on a representative fixture.

## Architectural Constraints (from SAD)
- This is **dev/test tooling** per SAD#1.2 / SAD#8.7 — it must NOT become a
  production ingestion path. No vendor SDK, no network fetch, no scraping.
- **No corporate-action adjustment** (SAD#2.2 / ADR-005 stays with STORY-015).
  Bars are trusted as pre-adjusted; record this assumption in the tool.
- Lives entirely on the data-source side of the `MarketDataProvider` port
  (SAD#5.10). The writer must NOT import the engine (`src/lib/market.ts`),
  React, or the DOM (engine purity, SAD#2.6).
- Schema is the SAD#6.1 instrument + daily OHLCV bar model; the store is
  read-only to the rest of the system (SAD#4.3).

## Out of scope
- The SQLite-backed read adapter behind the port — STORY-032.
- Corporate-action adjustment and the real vendor adapter — STORY-015 / ADR-008.
- Fetching, downloading, or scraping CSVs (ingests files already on disk).
- Data-quality validation beyond parse-error reporting (no gap detection,
  outlier scrubbing, or reconciliation).
- Any new HTTP endpoint or query API (reading is STORY-032 / the existing port).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- tools/eod-import/**
- package.json
