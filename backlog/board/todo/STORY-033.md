---
id: STORY-033
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#5.10, SAD#8.7, SAD#8.8]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an operator, I want the service to refuse to serve a **dev/test** market-data
adapter in a production environment, so that demo/imported data can never
silently back production screening traffic.

## Context
Surfaced by the STORY-032 code review (finding F5). Today `providerFromEnv`
(`server/universe.ts`) selects the dev/test SQLite adapter purely on the presence
of `MARKETDATA_DB`, and the synthetic adapter is the unconditional default —
neither has a production guard. SAD#8.7 (synthetic) and STORY-032 (SQLite) are
both explicitly dev/test-only; the real production source is the licensed-vendor
adapter, still open under ADR-008 (SAD#8.8). Until that lands there is no genuine
production data path, so this guard is a guardrail against a future
misconfiguration, not a today-bug — hence a separate story rather than an
in-scope STORY-032 fix.

## Acceptance Criteria
- [ ] In a production environment (e.g. `NODE_ENV=production`), selecting a
      dev/test adapter (synthetic, or SQLite via `MARKETDATA_DB`) fails fast with
      a clear error instead of serving dev/test data.
- [ ] In non-production environments behaviour is unchanged: synthetic by
      default, SQLite when `MARKETDATA_DB` is set.
- [ ] The guard is covered by a test for both the production-refusal and the
      dev/test-allowed paths.

## Architectural Constraints (from SAD)
- The guard lives at the service seam (`server/universe.ts`) behind the
  `MarketDataProvider` port (SAD#5.10); no engine or handler changes.
- Dev/test adapters must not leak into a production data path (SAD#8.7); the real
  production adapter is deferred to ADR-008 (SAD#8.8).

## Out of scope
- The licensed-vendor adapter itself (STORY-015 / ADR-008).
- Any change to the adapter reading logic (STORY-031 / STORY-032).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- server/universe.ts
- server/**/*.test.ts
