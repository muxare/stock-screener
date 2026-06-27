---
id: STORY-048
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#8.7, SAD#5.10, SAD#4.3]
target: ~
estimate: ~
attempts: 2
prev_column: ~
blocked_reason: ~
base_commit: e9ea925b3437a3a1eefdd3ba86593d7b16ae74e7
---

## User Story
As a developer, I want to switch the active market-data source at runtime —
between the synthetic generator and any already-built SQLite dev DB, and to run
an EOD CSV import from the browser — so I can iterate on real datasets without
restarting the service or editing env vars.

## Context
RETROACTIVE — documents dev-tooling shipped in commit `baa5240` alongside (but
outside the Touch scope of) STORY-035. STORY-035's own "Out of scope" explicitly
flagged "surfacing the live data source in the UI" as a clean follow-on once the
`MarketClient` seam existed; this is that follow-on. It builds the dev-only data
source-management surface on top of the seam and the STORY-031 CSV importer.

All of it is gated behind the `DEV_TOOLS` flag (SAD#8.7): when the flag is off,
the `/dev/*` routes fall through to 404 and the UI never renders, so the feature
cannot exist in a production deployment. The runtime swap is a provider swap
behind the `MarketDataProvider` port (SAD#5.10) — the production data path never
mutates the provider at runtime.

## Acceptance Criteria
- [x] `DEV_TOOLS`-gated server routes exist: `GET /dev/databases` +
      `POST /dev/databases/activate` (DB-selector) and `GET /dev/import/options`
      + `POST /dev/import` (EOD import). When the flag is off they 404.
- [x] `UniverseStore` gains `reload(provider?, source?)` and `source()`; the
      import and selector both hot-swap the active provider without a restart.
- [x] A gitignored `.dev-active-db` pointer persists the chosen dataset across
      `node --watch` restarts; `MARKETDATA_DB` still takes precedence, and a
      stale/deleted pointer silently falls back to synthetic (never crashes boot).
- [x] The `MarketClient` seam exposes `databases()` (`null` when DEV_TOOLS off)
      and `activateDatabase()`; the store gains `dbSelector` state with
      `probeDatabases()` / `selectDatabase()`, inert unless the service reports on.
- [x] TopBar shows a data-source badge (DB file name, or "DEMO DATA") and, when
      available, a dataset picker + an "Import data" button opening `DevImportModal`.
- [x] After an import or a switch, the universe facts + active screen refresh so
      results reflect the new data (no manual reload).

## Architectural Constraints (from SAD)
- Dev/test-only: the surface is the SAD#8.7 dev tooling, gated by `DEV_TOOLS`;
  it must not exist in a production build.
- All bar access stays behind the `MarketDataProvider` port (SAD#5.10) — the
  selector swaps the adapter, it does not bypass the port.

## Out of scope
- 2xx-with-unparseable-body handling for the import response (STORY-036).
- Skipping the guaranteed-404 dev probe on production startup (STORY-037).
- Sharing the wire-row / dev-import DTOs across client and server (STORY-038).

## Claude Code Prompt
> RETROACTIVE story: the work is already shipped in commit `baa5240`. This file
> documents it for backlog traceability; no new implementation is required.

## Touch scope
- server/devDataset.ts
- server/devImport.ts
- server/index.ts
- server/universe.ts
- src/lib/client/marketClient.ts
- src/store.ts
- src/components/TopBar.tsx
- src/components/modals/DevImportModal.tsx
- src/AppScreener.tsx
- vite.config.ts
- package.json
- .gitignore
