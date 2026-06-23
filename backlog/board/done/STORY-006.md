---
id: STORY-006
type: story
parent: FEAT-002
capability: CAP-indicators
sad_refs: [SAD#3.3, SAD#5.3, SAD#5.1, SAD#5.6]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want to build custom indicators so that I can screen and chart on my own EMA/SMA/RSI/MACD/Stoch-RSI definitions.

## Acceptance Criteria
- [x] Indicators of type EMA/SMA/RSI/MACD/Stoch-RSI over a chosen source (close/open/high/low/hl2/hlc3/volume).
- [x] Per-type parameter schema and defaults come from `INDICATOR_TYPES`/`IND_DEFAULTS` (SAD#5.6).
- [x] Saved indicators become screenable and chartable; series computed via `indSeries`.
- [x] An indicator def round-trips through persistence.

## Architectural Constraints (from SAD)
- Builder (SAD#5.3) reads schemas/defaults from catalogues (SAD#5.6); series math stays in the engine (SAD#5.1).

## Out of scope
- Repository abstraction (STORY-019).

## Status
DONE — as-built in `IndicatorBuilderModal.tsx` + `market.ts`.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/modals/IndicatorBuilderModal.tsx
- src/components/sidebar/Indicators.tsx
- src/lib/market.ts
- src/store.ts
