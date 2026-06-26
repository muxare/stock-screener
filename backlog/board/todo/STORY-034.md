---
id: STORY-034
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#5.10, SAD#4.3]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engineer, I want the `MarketDataProvider` port to support an explicit
lifecycle (dispose/close) so the SQLite adapter releases its read handle, letting
the importer rebuild the DB and tests avoid leaking connections.

## Context
Surfaced by the STORY-032 code review (finding F7). The SQLite adapter
(`src/lib/data/sqlite.ts`) opens a read-only `DatabaseSync` once and never closes
it; the port (`src/lib/data/provider.ts`) exposes no `close`/`dispose`. On a
host that locks open DB files (e.g. Windows), the STORY-031 importer cannot
overwrite `market.db` while a server holds the read handle; the test suite opens
a fresh connection per `beforeEach` that is never closed. This needs an interface
addition to the shared port (touching the synthetic adapter and the universe
store lifecycle too), which is why it was deferred from STORY-032 rather than
fixed in place.

## Acceptance Criteria
- [ ] `MarketDataProvider` gains an optional lifecycle method (e.g. `close()`)
      documented as releasing adapter-held resources; adapters with none make it
      a no-op (synthetic).
- [ ] `sqliteProvider` implements it by closing its `DatabaseSync` connection;
      after `close()` the handle is released (the importer can rewrite the file).
- [ ] The `UniverseStore`/service wiring disposes the provider on shutdown where
      applicable, and the SQLite test closes the provider before removing the
      temp DB (no leaked handles across the suite).

## Architectural Constraints (from SAD)
- Keep the change at the port + adapters (SAD#5.10); the engine stays pure
  (bars are passed in) and is untouched.
- The market-data store remains read-only to the rest of the system (SAD#4.3).

## Out of scope
- The licensed-vendor adapter (STORY-015 / ADR-008).
- Connection pooling / multi-connection concurrency.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/data/**
- server/universe.ts
