---
id: STORY-049
type: story
parent: FEAT-008
capability: CAP-screen
sad_refs: [SAD#6.1, SAD#4.1]
target: ~
estimate: ~
attempts: 2
prev_column: ~
blocked_reason: ~
base_commit: e9ea925b3437a3a1eefdd3ba86593d7b16ae74e7
---

## User Story
As a user reading a stock's detail chart, I want the time axis labelled with the
real calendar dates of the underlying bars, so the chart reflects the data's
actual trading days instead of fabricated weekdays.

## Context
RETROACTIVE — documents the date-axis plumbing shipped in commit `baa5240`
alongside (but outside the Touch scope of) STORY-035. Previously the detail chart
fabricated weekday dates ending at a hard-coded "today"; with real SQLite datasets
(STORY-031/032) the bars have genuine dates that the chart should show.

The date stays *beside* the bars, never inside the engine `Bar`: the engine has
no notion of "today" (ADR-002) and the `Bar` shape is pure OHLCV (SAD#6.1). A
parallel `dates` array is carried through the provider port and consumed only by
the client when it builds the `Stock` for a displayed name (SAD#4.1).

## Acceptance Criteria
- [x] `InstrumentBars.dates?` and `OHLC.d?` carry an ISO `YYYY-MM-DD` date per
      bar, parallel to the OHLC arrays; both optional so legacy fixtures that
      predate dates still build, and the engine never reads them.
- [x] The SQLite provider selects the `date` column and returns it as the
      parallel `dates` array (universe + single-instrument paths), covered by
      `sqlite.test.ts`.
- [x] The synthetic provider fabricates deterministic weekday dates anchored to a
      FIXED end date (never `Date.now()`), keeping the demo universe and its
      golden-master fixtures bit-for-bit deterministic.
- [x] `StockDetail` labels the time axis from `stock.full.d` when present, falling
      back to fabricated weekdays only for dateless legacy fixtures; the date cache
      is keyed per ticker (length match alone is insufficient).
- [x] A crosshair + per-candle readout (date + OHLCV) renders on an overlay canvas
      with no React re-render.

## Architectural Constraints (from SAD)
- The engine `Bar` stays pure OHLCV (SAD#6.1); dates live beside the bars, not
  inside them, and the engine never reads a calendar date (ADR-002).
- Only the client, building the `Stock` for displayed names (SAD#4.1), consumes
  the dates — for labelling, not computation.

## Out of scope
- Any indicator/screen math using dates — the engine remains date-agnostic.
- Intraday or non-daily bar granularity.

## Claude Code Prompt
> RETROACTIVE story: the work is already shipped in commit `baa5240`. This file
> documents it for backlog traceability; no new implementation is required.

## Touch scope
- src/lib/market.ts
- src/lib/data/sqlite.ts
- src/lib/data/sqlite.test.ts
- src/lib/data/synthetic.ts
- src/components/detail/StockDetail.tsx
