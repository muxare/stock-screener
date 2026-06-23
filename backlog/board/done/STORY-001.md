---
id: STORY-001
type: story
parent: FEAT-001
capability: CAP-screen
sad_refs: [SAD#3.1, SAD#5.1]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want to evaluate a composable rule set against the universe with AND/OR grouping so that I see exactly the names that match my screen.

## Acceptance Criteria
- [x] Rule sets evaluate with AND/OR grouping via `evalGroupedRules`/`evalGroupAt`.
- [x] `evalRuleAt` routes across all rule kinds (`num`/`flag`/`ema`/`ind`/`chain`/`group`/`pattern`/`rank`).
- [x] An empty rule set returns the full universe.
- [x] Matches are derived in the store and rendered in the results list.

## Architectural Constraints (from SAD)
- Engine logic lives in `src/lib/market.ts` and stays a pure, dependency-free, isomorphic module per SAD#5.1 — no DOM/`fetch`/global state inside it.
- Do NOT duplicate engine logic in components; components call the engine.

## Out of scope
- Server-side / full-universe scale (STORY-016).
- Automated POC-parity tests (STORY-020).

## Status
DONE — as-built in `src/lib/market.ts` + `src/store.ts`. Automated golden-master verification (SAD#2.1) is tracked in STORY-020.

## Claude Code Prompt
> Already implemented (as-built capture). If reopened, READ the `sad_refs` sections first and preserve POC semantics exactly; flag any conflict rather than improvising. Stay within Touch scope.

## Touch scope
- src/lib/market.ts
- src/store.ts
