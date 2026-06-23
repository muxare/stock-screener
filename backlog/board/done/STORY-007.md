---
id: STORY-007
type: story
parent: FEAT-002
capability: CAP-presets
sad_refs: [SAD#3.2, SAD#5.3, SAD#5.6]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want a preset library plus custom presets so that I can apply proven screens and save my own.

## Acceptance Criteria
- [x] The built-in `PRESETS` library is available (oversold-in-uptrend, MACD momentum, fresh MACD cross, volume breakout, Stoch-RSI turn, trend pullback, six TC2000 setups).
- [x] User can create, edit, and delete custom presets.
- [x] Built-in overrides and hidden built-ins are honoured.

## Architectural Constraints (from SAD)
- Preset definitions come from the SAD#5.6 `PRESETS` catalogue; custom presets are persisted artifacts (SAD#6.4).

## Out of scope
- Repository abstraction (STORY-019).

## Status
DONE — as-built in `PresetBuilderModal.tsx` + `store.ts` `presetStore`.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/modals/PresetBuilderModal.tsx
- src/components/sidebar/Presets.tsx
- src/store.ts
- src/lib/market.ts
