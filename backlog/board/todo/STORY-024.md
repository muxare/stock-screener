---
id: STORY-024
type: story
parent: FEAT-009
capability: CAP-detail
sad_refs: [SAD#5.7, SAD#5.10, SAD#4.2, SAD#4.3, SAD#2.5, SAD#6.1]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
---

## User Story
As a trader, I want the service to return the full OHLCV bars for a single named
instrument so that the client can render its detail chart and compare panes
without building the whole universe in the browser.

## Acceptance Criteria
- [ ] The `MarketDataProvider` port (SAD#5.10) exposes per-instrument bar access
      (e.g. `getInstrument(ticker)`), implemented by the synthetic adapter so a
      single name's bars are bar-for-bar identical to that name in `getUniverse()`.
- [ ] The Node service exposes a read endpoint that returns one instrument's
      adjusted OHLCV bars + metadata (the engine's `InstrumentBars`/`Stock` shape
      the detail/compare panels consume — `full.o/h/l/c/v` plus derived fields),
      keyed by ticker; unknown ticker → 404.
- [ ] Single-instrument fetch + build stays well within the SAD#2.3 50 ms
      single-name budget; no full-universe scan happens to serve one name.
- [ ] The endpoint reuses the SHARED engine to build the instrument (no second
      engine, SAD#8.3) and the SAD#5.10 provider port (no synthetic generator in
      a production code path).

## Architectural Constraints (from SAD)
- Per SAD#5.10 all bar access goes through the provider port; the engine never
  calls a provider directly (bars are passed in). The synthetic generator must
  not leak into a production path (SAD#4.3 / ADR-007).
- Per SAD#5.7 the handler loads bars from the provider and invokes the shared
  engine; no second engine implementation.
- Per SAD#2.5 this exists so the client computes only the names it displays —
  the response is one instrument, never the universe.

## Out of scope
- Client wiring to this endpoint and retiring the in-browser universe build —
  that is STORY-018 (blocked on this story).
- The full-universe screen/backtest endpoints — STORY-016 / STORY-017 (done).
- Vendor data adapter — ADR-008 (open).

## Status
TODO — prerequisite for STORY-018. STORY-018 was blocked because retiring the
in-browser full-universe build (AC2 / SAD#2.5) removes the only source of
per-name bars (`st.universe`) that the detail and compare panels read, while the
service `ScreenRow` carries no bars and the server was outside STORY-018's Touch
scope. This story supplies that missing per-displayed-name bar source so 018 can
become a pure client-wiring change.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- server/**
- src/lib/data/**
