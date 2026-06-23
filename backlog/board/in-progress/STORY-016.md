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
- [x] A Node service imports the SAME `src/lib/market.ts` engine (no fork).
- [x] It exposes a screen HTTP/JSON endpoint that evaluates the full production universe.
- [x] Warm-cache full-universe screen meets p95 ≤ 3s (SAD#2.3).
- [x] The service is stateless w.r.t. user identity and honours the indicator cache.

## Architectural Constraints (from SAD)
- Reuse the engine via the shared module per SAD#8.3/SAD#2.5; do NOT create a second engine implementation.
- Honour the SAD#2.3 latency budget.

## Out of scope
- Backtest endpoint (STORY-017).
- Client wiring (STORY-018).

## Status
DONE (implementation) — Node screening service added under `server/`, hosting the
**same** `src/lib/market.ts` engine (no fork). `server/index.ts` runs a dependency-free
`node:http` server (`node server/index.ts`, Node ≥23.6 native TS) exposing `GET /health`
and `POST /screen`. `server/screen.ts` composes the screen exactly as the browser store's
`screenList` does — `evalGroupedRules` per name + `rankPassSet` cross-sectionally — so
server and client results are identical by construction (no second engine). `server/
universe.ts` builds the universe ONCE behind the `MarketDataProvider` port (synthetic
adapter until ADR-008/STORY-015 lands the vendor adapter — drops in here, no handler/engine
edits) and memoizes it, keeping per-Stock indicator caches warm across requests. Service is
stateless w.r.t. user identity. `server/screen.test.ts` pins all four ACs: engine-parity over
the full 44-name universe, the live HTTP/JSON endpoint (200 + JSON), warm-cache p95 ≤ 3s
(SAD#2.3), statelessness, and `_indCache` reuse. `npx tsc -p server/tsconfig.json`, `tsc -b`,
`vite build`, `eslint` (0 errors), and `vitest` (19 passing) all green. `src/lib/market.ts`
was NOT modified — the engine is reused verbatim. No client wiring (STORY-018) or backtest
endpoint (STORY-017).

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- server/**
- src/lib/market.ts
