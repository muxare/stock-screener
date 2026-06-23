---
id: STORY-004
type: story
parent: FEAT-001
capability: CAP-patterns
sad_refs: [SAD#3.7, SAD#5.1, SAD#5.6]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want price-action pattern filters so that I can screen for candlestick and structure setups.

## Acceptance Criteria
- [x] Patterns supported: consecutive up/down, higher/lower highs+lows, inside/outside bar, bull/bear engulfing, gaps, N-bar high/low breakouts, RSI bull/bear divergence, doji.
- [x] Patterns evaluate via `evalPatternAt`.
- [x] The `PATTERNS` catalogue (SAD#5.6) drives the filter UI.

## Architectural Constraints (from SAD)
- Pattern logic lives in `market.ts`; option lists come from the SAD#5.6 catalogues, not inline copies.

## Out of scope
- Automated parity tests (STORY-020).

## Status
DONE — as-built in `market.ts` + sidebar filters.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/lib/market.ts
- src/components/sidebar/FilterSections.tsx
