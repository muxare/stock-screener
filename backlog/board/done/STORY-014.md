---
id: STORY-014
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#5.10, SAD#2.6, SAD#8.7, SAD#8.4]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As an engineer, I want a `MarketDataProvider` port with the synthetic generator extracted behind it so that the engine stays pure and the data source is swappable.

## Acceptance Criteria
- [x] A `MarketDataProvider` interface returns adjusted OHLCV bars + universe metadata.
- [x] The synthetic generator (`mulberry32`/`genSeries`/`generateUniverse`) is moved OUT of `src/lib/market.ts` into a synthetic adapter used in dev/test only.
- [x] The engine no longer exports or embeds any data generator (SAD#2.6 / ADR-007).
- [x] All bar access goes through the port; engine functions receive bars as arguments and never fetch (ADR-004).

## Architectural Constraints (from SAD)
- Engine must remain pure/isomorphic per SAD#2.6; the synthetic adapter is dev/test-only per SAD#8.7 and must not leak into production paths.
- Bars are passed in, never fetched by the engine, per SAD#8.4.

## Out of scope
- Choosing a real vendor (STORY-015 / ADR-008).

## Status
DONE (implementation) — `MarketDataProvider` port added at `src/lib/data/provider.ts`; the
synthetic generator (`mulberry32`/`genSeries`/`TICKERS`/`DAYS`) was extracted to a dev/test-only
adapter `src/lib/data/synthetic.ts` (`syntheticProvider(seed)`). The engine's `generateUniverse`
was split: the data generator left the engine entirely, and Stock-building became the pure
`buildUniverse(InstrumentBars[])` / `buildStock(InstrumentBars)` which take bars as arguments.
`store.ts` now sources bars via `syntheticProvider(seed).getUniverse()` and builds with
`M.buildUniverse(...)`. Verified bar-for-bar identical to the pre-refactor `generateUniverse`
across seeds 7/8/42/100 (~4MB serialized universe each). `tsc -b`, `eslint`, and `vite build`
all green.

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- src/lib/market.ts
- src/lib/data/**
- src/store.ts
