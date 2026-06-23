---
id: STORY-003
type: story
parent: FEAT-001
capability: CAP-screens
sad_refs: [SAD#3.6, SAD#5.3, SAD#5.1]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want to save ordered comparison chains by name so that I can reuse a screen like `EMA18 > 50 > 100 > 200`.

## Acceptance Criteria
- [x] Ordered comparison chains are authored and evaluated via `evalChainAt`.
- [x] A chain is saved by name and reloadable.
- [x] Saved chains survive a reload (localStorage today).

## Architectural Constraints (from SAD)
- Chain evaluation stays in the SAD#5.1 engine; the builder (SAD#5.3) only assembles operands.

## Out of scope
- Repository abstraction for saved screens (STORY-019).

## Status
DONE — as-built in the screen builder + `market.ts`; persisted via `store.ts`.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/components/modals/ScreenBuilderModal.tsx
- src/components/sidebar/Screens.tsx
- src/lib/market.ts
- src/store.ts
