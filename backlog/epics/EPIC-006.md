---
id: EPIC-006
type: epic
parent: ~
sad: SAD-003
sad_refs: SAD-003#1, SAD-003#3, SAD-003#5, SAD-003#6, SAD-003#8.1
capabilities: CAP-eod-fetch, CAP-eod-ingest, CAP-eod-coverage
---

# EPIC-006 — Yahoo Finance EOD market-data fetch

Add the one missing link the data layer still lacks — a **network fetcher** that
pulls daily OHLCV from Yahoo Finance and lands it in the existing `SAD-001#6.1`
SQLite schema, where the STORY-032 `sqliteProvider` already serves it through the
`MarketDataProvider` port with **no engine, handler, or port change**. Resolves
the open vendor question (`SAD-001#8.8 / ADR-008`) by selecting Yahoo Finance EOD
for a personal / non-redistributing deployment (`SAD-003#8.1 / ADR-001`).

## Goal
A historical backfill over a supplied ticker universe writes a SQLite DB the app
and screening service run against **exactly** as against synthetic (`SAD-003#2.1`),
with `bar.c` set to Yahoo's `adjClose` (`SAD-003#2.3`); a daily post-close append
is idempotent (`SAD-003#2.2`); and every run reports coverage + freshness with no
silently dropped names (`SAD-003#2.4`).

## Capabilities covered
- `CAP-eod-fetch` (SAD-003#3.1) — Yahoo EOD network fetcher
- `CAP-eod-ingest` (SAD-003#3.2) — fetch → existing importer → SQLite DB
- `CAP-eod-coverage` (SAD-003#3.3) — coverage & freshness reporting + partial-failure policy

## Status note
**Not started.** The data layer downstream of "bars on disk" already exists and
is reused, not rebuilt: `tools/eod-import` (STORY-031) writes the schema and
`sqliteProvider` (STORY-032) serves it. This epic adds only the ingestion-side
fetcher (`SAD-001#4.3`); it adds no new `SAD-001#5.10` read adapter (`SAD-003#8.7
/ ADR-007`). The licensed-vendor / redistribution path (STORY-015) stays blocked.

## Notes
- Features under this epic live in `backlog/features/FEAT-*.md` with `parent: EPIC-006`.
