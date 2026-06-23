---
id: STORY-016
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#4.2, SAD#5.7, SAD#2.3, SAD#2.5, SAD#8.3]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want full-universe screens to run server-side so that screening thousands of names stays fast.

## Acceptance Criteria
- [ ] A Node service imports the SAME `src/lib/market.ts` engine (no fork).
- [ ] It exposes a screen HTTP/JSON endpoint that evaluates the full production universe.
- [ ] Warm-cache full-universe screen meets p95 ≤ 3s (SAD#2.3).
- [ ] The service is stateless w.r.t. user identity and honours the indicator cache.

## Architectural Constraints (from SAD)
- Reuse the engine via the shared module per SAD#8.3/SAD#2.5; do NOT create a second engine implementation.
- Honour the SAD#2.3 latency budget.

## Out of scope
- Backtest endpoint (STORY-017).
- Client wiring (STORY-018).

## Status
TODO — not started. Screening runs in-browser today (`store.ts`).

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- server/**
- src/lib/market.ts
