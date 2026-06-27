---
id: STORY-035
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#2.5, SAD#4.1, SAD#5.9]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: e9ea925b3437a3a1eefdd3ba86593d7b16ae74e7
---

## User Story
As a developer, I want all client-to-service HTTP behind one typed
`MarketClient` seam that the store consumes, so that the store's data flow is
unit-testable without a network and the transport has a single home — leaving
the seam stable when the server-side data *source* later swaps to a real vendor.

## Context
Today the client has no data-access abstraction: six raw `fetch()` helpers
(`apiFacts`, `apiInstrument`, `apiScreen`, `apiBacktest`, `apiDevImportOptions`,
`apiDevImport`) sit at the top of `src/store.ts` and are called directly by store
actions, and there are no client-side store tests at all — the fetch logic is
untestable without a live service. This mirrors the *server* side, which already
routes all bar access through the `MarketDataProvider` port (SAD#5.10); the
client deserves the same seam. The server's host/HTTP boundary is SAD#4.2/5.7;
this story is the **client** counterpart consumed by the Zustand store (SAD#5.9),
honouring the client/server split (SAD#2.5).

Naming is deliberate: this is a **client** (the client-side read seam), NOT a
"repository" — that word is reserved in this codebase for artifact persistence
(SAD#5.8 / ADR-006). It is also distinct from the server-side provider *port*
(SAD#5.10).

## Acceptance Criteria
- [x] A `MarketClient` interface plus an `httpMarketClient()` implementation
      exist in `src/lib/client/`, exposing exactly today's calls: `facts`,
      `instrument`, `screen`, `backtest`, `devImportOptions`, `devImport`. No
      speculative methods.
- [x] The six `api*` functions (and the NDJSON backtest parser) move out of
      `src/store.ts` into `httpMarketClient` with identical behaviour: same
      endpoints, `404 → null` for instrument, throw on `!res.ok`, NDJSON
      progress→result parsing, dev-import options `null` when DEV_TOOLS off.
- [x] The client is pure transport: it accepts an optional `AbortSignal` and
      forwards it to `fetch`, but never creates one. Generation counters and
      `AbortController`s stay in the store (orchestration, not transport).
- [x] The store consumes an injected `MarketClient` (default `httpMarketClient()`)
      via a `makeScreenerState(client)` factory; `useScreener` is unchanged for
      callers. All former `api*` call sites route through `client.*`.
- [x] `httpMarketClient` is covered by tests (endpoint shapes, `404 → null`,
      NDJSON parse, error throws) using a stubbed `fetch`.
- [x] A first `src/store.test.ts` exercises store orchestration with an injected
      fake client (no network): stale-generation responses are dropped, the
      `screenError` banner is set on failure, and `displayed[]` caches by ticker.
- [x] No behavioural change to the running app; no server changes.

## Architectural Constraints (from SAD)
- Full-universe screen/backtest stay server-side; the client computes only for
  displayed names (SAD#2.5). This story moves the transport, not the compute —
  no engine logic crosses the seam.
- The client (SAD#4.1) talks to the service over HTTP/JSON; the new seam is the
  single place that does so, consumed by the store (SAD#5.9, "single client-side
  source of truth"). Do NOT stash bar arrays or engine functions in the client.
- Name it a `MarketClient` — NOT a "repository" (reserved for SAD#5.8 artifact
  persistence) and NOT a "provider" (SAD#5.10 is the server port).

## Out of scope
- Surfacing the live data **source** in the UI (the "DEMO DATA" badge that
  reflects synthetic vs SQLite vs vendor). The `MarketClient` makes this a clean
  follow-on once `/facts` carries a source descriptor — track separately.
- Any server-side change: the real-vendor source swap is entirely server-side
  (provider port; STORY-015 / ADR-008, blocked) and needs no client change.
- Changing endpoint shapes, error semantics, or the generation/abort logic.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/client/**
- src/store.ts
- src/store.test.ts
