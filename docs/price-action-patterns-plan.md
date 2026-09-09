# Price-action patterns — implementation plan

Status (2026-09-08): **phase 1 landed — detection + chart overlay**. Phases 2 and 3
(screening on patterns, the trade-review chart) are open and independent of each other.

## Context

The detail chart draws candles, four EMAs, volume, MACD and Stoch RSI: everything except
what the bars themselves are saying. Reading structure — where the swings are, whether the
highs are still making higher highs, whether that three-bar dip is a pullback or the trend
turning — was left to the eye, on a chart dense enough that the eye gets it wrong.

Mikael's brief (2026-09-08) named eleven patterns in three families:

- **swing structure** — pivots (long and short), the HH/HL/LH/LL sequence, pullbacks
- **reversals** — 2-bar, 3-bar, pin bar, engulfing, failed breakout
- **bar shapes** — inside, outside, doji

These are *readings*, not signals: they say who is in control, where a stop logically sits,
and whether a move is continuation or turn. That framing is what keeps them out of
`lib/strategy/` — the step machine already has its own, deliberately different, definitions
of a two-bar reversal and a pullback, tuned for entries rather than for reading a chart.

## Phase 1 — detection and the chart overlay *(landed)*

### Touch scope
- `src/lib/patterns.ts` (new) — the detectors and the registry
- `src/lib/chart/patternLayer.ts` (new) — the canvas glyph vocabulary
- `src/components/ui/ChartControls.tsx` — the Patterns chooser
- `src/components/detail/FanDetail.tsx` — wiring, plus patterns in the crosshair readout
- `src/help/glossary.ts`, `src/help/HelpCard.tsx` — a `pattern` help kind and twelve cards

### Design

**One marker type for all eleven.** A `PatternMarker` is `{ id, index, from, to, dir, price,
tag, note }`: the bar that *confirms* it, the bars it spans, which way it leans, the price it
turns on, a two-or-three-character chart label and a line of prose. The drawing layer needs
nothing else, and neither does the readout — which is why adding a twelfth detector is
adding a function and a registry row, not touching the chart.

`from`/`to` are the bars the pattern *is*, not the bars that confirmed it. A pivot spans one
bar and carries `strength` (how many bars either side agreed); an inside bar spans two. This
is what makes "which patterns is this bar part of?" answerable by an interval test.

**Every threshold in `PatternConfig`.** Defaults match the brief (3-bar and 1-bar pivots, a
2-bar minimum pullback, a 20-bar breakout level); a test or a later filter overrides one
without forking a detector. A shared noise floor — a bar must be at least a quarter of
ATR(14) — keeps the single-bar shapes off quiet sessions.

**Confirmed only.** Nothing is drawn before the bars that establish it have printed, so the
last few bars carry no pivot and no failed breakout. The chart never shows knowledge that
was not available on the day.

**Detection is over the full history, drawing is over the window.** Panning cannot change
what a pattern is, and the chooser can show how many of each exist before you turn one on.

### Verification
- `npm test` — `src/lib/patterns.test.ts`, 36 cases: one per detector plus its near-miss
  (the second bar that barely recovers, the long wick with a fat body, the break that holds),
  the confirmation edges, and the combined result's ordering and independence.
- `src/help/glossary.test.ts` — every registry entry has a help card behind it.
- `npm run dev` → click a row → **Patterns**: pivots and HH/HL/LH/LL are on by default;
  counts beside each name are for the visible window; hover a bar for the patterns it is in.

## Phase 2 — screening on patterns *(open)*

Make a pattern a screener field: "pin bar within the last 3 bars", "inside bar yesterday",
"still making higher lows". The detectors already return the confirming bar, so a
`barsAgo`-style clause is the natural shape.

- Touch scope: `src/lib/screen/snapshot.ts`, `fields.ts`, `filters.ts`, `server/screen.ts`
- The open question is cost: detection over every name in the universe on every scan, versus
  a snapshot of "most recent marker per pattern" computed once at `buildStock` time. Measure
  before choosing.

## Phase 3 — the trade-review chart *(open)*

`FanTradeReview` draws the same candles and takes the same `ChartControls`; the `patterns`
prop is optional precisely so it can opt in later. Worth doing once phase 2 settles what a
trader wants to see at the entry bar.

## Out of scope

Multi-bar chart patterns that need trendline fitting (triangles, wedges, head-and-shoulders),
and anything requiring intraday data.
