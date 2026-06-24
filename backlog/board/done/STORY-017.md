---
id: STORY-017
type: story
parent: FEAT-009
capability: CAP-backtest
sad_refs: [SAD#4.2, SAD#5.7, SAD#2.4, SAD#2.5, SAD#8.3]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want full-universe backtests to run server-side so that a full-history backtest completes within budget without freezing the UI.

## Acceptance Criteria
- [x] A backtest endpoint runs `backtestRules` over the full universe server-side.
- [x] Full-universe + full-history backtest completes within ≤ 30s (SAD#2.4).
- [x] The result is returned as a single summary payload (SAD#6.5).
- [x] Long-running backtests report progress and never block the UI thread.

## Architectural Constraints (from SAD)
- Reuse the shared engine per SAD#8.3; honour the SAD#2.4 budget; rank rules stay excluded (SAD#3.8).

## Out of scope
- Client wiring (STORY-018).

## Status
DONE (implementation) — `POST /backtest` added to the Node service (`server/index.ts`),
hosting the **same** `src/lib/market.ts` engine (no fork). `server/backtest.ts`
composes the backtest exactly as the browser store's `openBacktest` does — calling
the shared `backtestRules` and dropping rank rules from history (SAD#3.8) — so server
and client backtests are identical by construction. The engine gained an optional,
advisory `onProgress` callback (backward-compatible) so the service can report
progress while staying on the one engine. The endpoint streams NDJSON: throttled
`progress` lines while the full-universe/full-history backtest runs, then exactly one
`result` line carrying the SAD#6.5 summary payload plus `elapsedMs` and the SAD#2.7
naive-fidelity `label`. Heavy compute runs server-side, off the browser UI thread
(SAD#2.5). Pinned by `server/backtest.test.ts` (8 tests): engine parity (no fork),
rank-exclusion, SAD#6.5 shape, the ≤30s SAD#2.4 budget, monotonic progress, and the
HTTP NDJSON contract. Full suite 27/27, lint + tsc (app & server) clean.

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- server/**
- src/lib/market.ts
