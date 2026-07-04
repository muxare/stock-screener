---
id: FEAT-018
type: feature
parent: EPIC-006
sad_refs: SAD-003#3.1, SAD-003#3.2, SAD-003#5.1, SAD-003#5.2, SAD-003#6.1
capabilities: CAP-eod-fetch, CAP-eod-ingest
---

# FEAT-018 — Yahoo EOD fetch & ingestion pipeline

The fetch front-end and its seam into the existing importer: pull Yahoo EOD bars
over the network, normalise them into the importer's CSV input, and land them in
the `SAD-001#6.1` schema — historical backfill plus an idempotent daily append —
reusing `tools/eod-import` (STORY-031) and `sqliteProvider` (STORY-032) unchanged.

## Parent
EPIC-006

## Capabilities covered
- `CAP-eod-fetch` (SAD-003#3.1) — the network fetcher (`SAD-003#5.1`).
- `CAP-eod-ingest` (SAD-003#3.2) — the fetch→importer→DB seam (`SAD-003#5.2`),
  backfill + daily-append run modes.

Stories use `parent: FEAT-018` and one of the capability ids above.

## Notes
- Create stories via `python workflow/tools/board.py new --capability <id> --parent FEAT-018`.
