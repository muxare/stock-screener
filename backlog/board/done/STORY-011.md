---
id: STORY-011
type: story
parent: FEAT-005
capability: CAP-detail
sad_refs: [SAD#3.10, SAD#5.4, SAD#5.5, SAD#5.1]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want an interactive detail chart with the screen's overlays and a per-rule explanation so that I can confirm a name and understand why it fired.

## Acceptance Criteria
- [x] Candlesticks with EMA(9/20/50/200) overlays; volume/MACD/RSI/Stoch panes.
- [x] Pan/zoom, double-click reset, and panel toggles.
- [x] Signal markers where the screen fires; dashed overlays for custom price-scale indicators referenced by rules.
- [x] Each rule shows pass/fail plus a 'why it fired' sparkline (`whySpark`); single-name eval uses the engine.

## Architectural Constraints (from SAD)
- Call the engine locally for single-name eval per SAD#2.3 (≤50ms); chart components stay presentational; engine math stays in SAD#5.1.

## Out of scope
- Chart keyboard accessibility (STORY-023, SAD#2.9).
- Disclosure on the detail surface (STORY-022).

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/detail/StockDetail.tsx
- src/components/detail/DetailPanels.tsx
- src/components/ui/Spark.tsx
