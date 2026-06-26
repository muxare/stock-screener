---
id: STORY-032
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#5.10, SAD#4.3, SAD#6.1, SAD#2.6, SAD#8.7]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engineer, I want a SQLite-backed `MarketDataProvider` adapter so that the
app and screening service can run against the imported dev/test database through
the existing port, with no engine or handler changes.

## Context
Refined from IDEA-001 / PLAN-002; the **reader** half paired with the importer
(STORY-031). It implements the same port as the synthetic adapter (STORY-014,
`src/lib/data/synthetic.ts`) and is selected at the existing service seam
(`server/universe.ts`, which today wires `syntheticProvider(7)` and notes the
swap is "a one-line change here"). It is **dev/test only** — NOT the licensed
vendor adapter (STORY-015 / ADR-008).

## Acceptance Criteria
- [ ] A `sqliteProvider(dbPath)` in `src/lib/data/` implements
      `MarketDataProvider` (`getUniverse()` and `getInstrument(ticker)`),
      reading a DB produced by STORY-031.
- [ ] Reads are **synchronous** — the port is synchronous (`getUniverse():
      InstrumentBars[]`), so the adapter uses a synchronous SQLite access library.
- [ ] Bars are returned in **chronological order** as `Bar[]` (`{o,h,l,c,v}`);
      the DB `date` column orders the bars but is not part of the engine `Bar`
      shape (SAD#6.1 / `src/lib/market.ts`).
- [ ] `getInstrument(ticker)` returns one instrument's bars + metadata, or `null`
      for an unknown ticker; its bars are identical to that name in
      `getUniverse()`.
- [ ] The provider is selectable at the service seam (`server/universe.ts`) —
      e.g. via an env var / config path — without editing handlers or the engine
      (mirrors the one-line swap documented there).
- [ ] The adapter performs **no** corporate-action adjustment (trusts the
      importer's pre-adjusted bars) and contains no vendor SDK.

## Architectural Constraints (from SAD)
- Implement the port (SAD#5.10) alongside `synthetic.ts`; depend on the port
  contract only, never engine internals. The engine stays pure (SAD#2.6) and
  receives bars as arguments — the adapter never calls into it.
- **Dev/test-only** per SAD#8.7 — must not leak into a production data path and
  is explicitly NOT the licensed-vendor adapter (STORY-015 / ADR-008 / SAD#2.2).
- The market-data store is read-only to the rest of the system (SAD#4.3).

## Out of scope
- The CSV → SQLite importer / schema definition — STORY-031.
- The real vendor adapter, corporate-action adjustment, and legal sign-off —
  STORY-015 / ADR-008.
- Any new HTTP endpoint (reading flows through the existing `UniverseStore` and
  service handlers).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/data/**
- server/universe.ts
- package.json
