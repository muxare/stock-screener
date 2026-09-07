# Development diary

## 2026-09-07 — Strategy builder replaces the fixed fan strategies

### What changed
A strategy is no longer one of eight hardcoded ids with its own detector in `fanBacktest.ts`. It is a
**`StrategyDef`**: an ordered state machine of parameterized steps plus three editable trade rows
(entry / stop / exit). The eight former strategies are built-in presets made of steps, and one engine
serves the backtest, the live signal scan and the schematic example. This entry closes the four-phase
plan in `docs/strategy-builder-plan.md`.

- `src/lib/strategy/` — `types.ts` (the model), `primitives.ts` (predicates moved verbatim out of
  `fanBacktest.ts`), `steps.ts` (the step-type registry: kind, holdability, defaults, a param schema
  that drives *both* the parser's coercion and the builder's controls, and `compile`), `engine.ts`
  (walks the steps bar by bar and records one mark per step), `trade.ts` (the R simulator, driven by
  an `ExitSpec`), `presets.ts`, `parse.ts` (shared by server and localStorage), `example.ts`
  (synthesises a sketch and runs the **real** engine over it) and `storage.ts`.
- The backtest modal's strategy `<select>` is now `StrategyBuilder.tsx`: preset / saved picker with
  Save · Save as · Reset · Delete, step cards (type, generated params, hold, max wait, reorder,
  remove), an add-step menu, and the Entry / Stop / Exit rows — the Target, Max hold, breakeven and
  MACD controls moved in from the modal. Custom strategies are saved in localStorage under
  `stockScreener.strategies.v1` and are listed next to the presets in the filter bar; the signal scan
  sends a preset as its id and a saved strategy as its definition.
- Steps are typed by **kind**, which is what makes the machine composable: `candle` consumes a bar,
  `instant` fires on the same bar as the step before it, `guard` must hold on the bar the previous
  step fired, `tracker` fires once and then follows the swing high. A step marked *hold* is an
  invariant — when it breaks, the machine resets to step 1.
- Parity is exact: the new engine reproduces the old one's 14,899 entries across all eight presets —
  same entry bar, price, stop, exit bar and exit reason.

```mermaid
flowchart LR
  B[StrategyBuilder] -->|StrategyDef| S[(localStorage)]
  B --> P[parseStrategyDef]
  S --> P
  H["POST /backtest · /signals"] --> P
  P --> E[strategy/engine]
  E --> BT[fanBacktest: scan · stats · cash book]
  E --> SG[fanSignals: open entries]
  E --> EX[strategy/example: schematic + per-step checks]
```

### How to test
- `npm run typecheck`, `npm run test`, `npm run lint`
- `npm run dev`, then **Backtest**: every preset draws an example with one mark per step and a ✓ list;
  pick *New strategy…*, edit the steps, watch the schematic redraw, **Save**, reload — it is still in
  the picker and in the filter bar's *Entry strategy* list; selecting it there scans the universe with
  its definition; **Delete** falls back to the fan lists. Editing a preset marks it *edited* and can
  only be kept via **Save as**. Add a step that cannot fire (e.g. *high below the 200-EMA* after a
  50-EMA tag) and the right pane names the step that never completed.
- ```bash
  curl -s localhost:8787/backtest -H 'content-type: application/json' -d '{"strategy":"tag50","horizons":[5]}' | tail -1 | head -c 200
  curl -s localhost:8787/backtest -H 'content-type: application/json' -d '{"strategy":{"steps":[]}}'   # 400 JSON
  ```

---

## 2026-09-04 — Retire the rule engine and the DAG layer

### What changed
The product has run on the EMA-fan pipeline (`fan.ts`, `fanBacktest.ts`, `fanSignals.ts`) since the 2026-08-24 pivot. The general rule engine in `market.ts` (`evalRule*`, `PRESETS`, `parsePCF`, `evalPatternAt`, `rankPassSet`, `backtestRules`) and the computation-DAG layer under `src/lib/dag/` had no consumer outside their own tests, so both are removed. STORY-045 (DAG compatibility surface) and STORY-047 (DAG schedule surface) are closed as superseded by ADR-008's pivot; neither had a product on the other side.

- `src/lib/indicators.ts` now holds the indicator math (`ema`, `sma`, `rsi`, `stochRsi`, `macd`), moved verbatim.
- `src/lib/market.ts` shrinks to the `Stock` model, `InstrumentBars`, `HorizonStat`, and `buildStock`/`buildUniverse`. The legacy per-bar `Snapshot`, the `snapAt`/`snapAbs`/`ensureEma` hooks, the lazy caches and the index signature on `Stock` are gone with the engine that read them.
- `tests/engine.golden.test.ts` keeps the fixture and indicator pins; the rule, PCF and backtest sections and their snapshot entries are dropped. `src/lib/fidelity.test.ts` (the old-vs-DAG differential) is deleted with the DAG.

```mermaid
flowchart LR
  DB[(SQLite)] --> U[buildUniverse]
  I[indicators.ts] --> U
  I --> F[fan.ts · fanBacktest.ts · fanSignals.ts]
  U --> F
  F --> API["/screen · /signals · /backtest"]
```

### How to test
- `npm run typecheck`, `npm run test`, `npm run lint`
- `npm run dev` — the two lists, detail chart, signal scan and backtest behave as before.

---

## 2026-08-26 — Shift-drag zoom range on candlestick charts

### What changed
Hold **Shift** and drag on the chart to marquee-select a bar range; on release the viewport zooms to that inclusive candle range (start bar → end bar). Blue dashed overlay while dragging. Works on `FanDetail` and `FanTradeReview`. Control strip hint updated.

```mermaid
sequenceDiagram
  participant User
  participant Canvas
  participant Overlay
  participant Viewport
  User->>Canvas: mousedown + Shift
  Canvas->>Overlay: draw marquee (bar indices)
  User->>Canvas: drag
  Canvas->>Overlay: update marquee
  User->>Canvas: mouseup
  Canvas->>Viewport: setRange(minBar, maxBar)
  Viewport-->>Canvas: clamped view redraw
```

### How to test
- `npm run test` and `npm run lint`
- UI: open a stock detail or trade review chart, hold Shift, drag across several candles, release — chart zooms to that span. Plain drag still pans; scroll still zooms.

---

## 2026-08-26 — Zoom/pan + toggleable MACD & Stoch RSI on candlestick charts

### What changed
Both candlestick charts — the main **detail** chart (`FanDetail`) and the backtest **trade review** (`FanTradeReview`) — now share zoom/pan and toggleable indicator panes.

- **Zoom / pan**: mouse-wheel zooms toward the cursor, click-drag pans, plus a control strip with −/+ zoom and **Reset view** (enabled only when zoomed/panned off the default window). Min window is 8 bars. Price/volume auto-fit to the visible bars.
- **Indicators**: **MACD 12/26/9** and **Stoch RSI 14/3/3** panes, each toggled on/off (default on). `FanTradeReview` previously drew both always-on; `FanDetail` had neither.
- Extracted the shared pieces so both charts behave identically instead of duplicating: a `useChartViewport` hook, `drawMacdPane`/`drawStochPane` renderers, and a `ChartControls` strip. Indicator math is reused from `market.ts` (`macd`, `rsi`, `stochRsi`) — none reinvented.

Out of scope by design: the synthetic `FanExampleChart` schematic and the tiny `Spark`/`EquitySpark` sparklines.

```mermaid
flowchart LR
  subgraph shared[src/lib/chart + ui]
    VP[useChartViewport\nzoom / pan / reset]
    Panes[drawMacdPane / drawStochPane]
    Ctrls[ChartControls]
  end
  Market[market.ts\nmacd / rsi / stochRsi] --> Panes
  VP --> FD[FanDetail]
  VP --> TR[FanTradeReview]
  Panes --> FD
  Panes --> TR
  Ctrls --> FD
  Ctrls --> TR
  Wheel[wheel = zoom toward cursor] --> VP
  Drag[drag = pan] --> VP
```

### How to test
- `npm run test` (408 pass) and `npm run lint` (clean)
- UI: `npm run dev` → click a row for the detail chart, or Backtest → run → open a trade. Scroll to zoom, drag to pan, toggle **MACD** / **Stoch RSI**, and use −/+ / **Reset view**. Canvas height reflows as panes toggle.

---

## 2026-08-26 — Live "current entry" screen (strategy filter)

### What changed
The main screener can now filter to **names with a live open entry** for a chosen strategy, with the trade numbers a trader acts on: **entry**, **stop loss**, **R (risk)**, and the **2.5–3R exit window** (as prices). Pick a strategy in the new **Entry strategy** dropdown in the filter bar → the two fan lists are replaced by an **Entries** table; "Fan lists (no entry)" returns to the classifier view.

- A live entry reuses the backtest detector (`findFanEntries`) under a fixed, un-managed 3R config, then keeps the one entry whose simulated trade is still **open on the latest bar** (`exitReason === 'end_of_data'`) — i.e. price is still between the initial 1R stop and target.
- Volume / cap / 200-EMA-slope filters feed the server scan; sector / min-price / search are applied client-side (no re-scan). New endpoint `POST /signals`.

```mermaid
flowchart LR
  Bar[Entry strategy dropdown] --> Store[setSignalStrategy → runSignals]
  Store --> API["POST /signals {strategy, vol, cap, slope}"]
  API --> Scan[screenFanSignals: findFanEntries per name]
  Scan --> Open{trade still open on last bar?}
  Open -->|yes| Row[entry / stop / R / 2.5–3R target]
  Open -->|no| Drop[skip]
  Row --> UI[Entries table]
```

### How to test
- `npm test` — `src/lib/fanSignals.test.ts` (open-entry selection, R + target-window math, filters) and `src/store.test.ts` (scan on strategy pick, re-scan on vol/cap/slope only, error state)
- `npm run dev` → filter bar → **Entry strategy** → pick e.g. Fan onset; rows show Entry / Stop / R / Target window; click a row for the chart
- `curl -s -X POST http://localhost:8787/signals -H 'content-type: application/json' -d '{"strategy":"onset"}'`

---

## 2026-08-26 — Backtest textbook example pane

### What changed
The fan backtest modal now has a **schematic candlestick pane** to the right of the config. It redraws with the selected strategy, target, MACD window, continuation, and max-hold — colored phase bands, EMA 18/50/100/200, and entry/stop/target (or trail) levels. Not a live ticker; EMA spacing is exaggerated on purpose.

```mermaid
flowchart LR
  Cfg[Backtest config] --> Ex[buildFanExample]
  Ex --> Chart[FanExampleChart]
  Chart --> Phases[Colored setup / tag / hold bands]
  Chart --> Ind[EMA fan + optional 18-50 MACD]
```

### How to test
- `npm test` — `src/lib/fanExample.test.ts`
- UI: Backtest → change Strategy / Target / MACD / continuation; the right pane should retitle and re-color

---


## 2026-08-25 — Trail confirmed pivot lows

### What changed
Backtest Target can trail **2¢ under each newly confirmed long pivot** after entry (`trailPivot`). Only confirms in `(entry, now]` raise the stop; never loosens. MACD and the default max-hold do not cut while the slow fan holds — same as trail-50. Default remains trail 50.

```mermaid
flowchart TD
  Fill[Fill and initial stop] --> Bar[Each later bar]
  Bar --> Hit{Low tags stop?}
  Hit -->|yes| Out[pivot_trail]
  Hit -->|no| Confirm[Confirmed pivot after entry?]
  Confirm -->|yes| Ratchet["stop = max of stop, pivot low minus 2c"]
  Confirm -->|no| Bar
  Ratchet --> Bar
```

### How to test
- `npm test` — post-entry confirm ratchets then trails out; pre-entry confirm does not; MACD/max-hold skipped; parse `{ trailPivot: true }`
- UI: Backtest → Target → **Trail pivots** (default still Trail 50-EMA)

---

## 2026-08-25 — Bunn continuation entry

### What changed
New backtest strategy `bunn_cont` (not the default). Course Entry #1: 18 adversely crosses 50 while `50>100>200` holds, a Bunn reversal on 100 or 200 during that correction, then a buy stop 2¢ above the bar that **resumes** the full fan. 1R is the bounce low minus 2¢.

```mermaid
stateDiagram-v2
  stacked: Slow fan holds
  adverse: 18 crosses down through 50
  tagged: Reversal on 100 or 200
  resume: Full fan resumes
  fill: Buy stop 2c above resume high
  stacked --> adverse
  adverse --> tagged
  tagged --> resume
  resume --> fill
```

### How to test
- `npm test` — fill ≠ resume close, R from bounce low, no 100/200 bounce → no trade, `tag50` / bounce fixtures unchanged
- UI: Backtest → Strategy → **Bunn continuation** (default remains 50-EMA tag)

---

## 2026-08-25 — Confirmed long pivots

### What changed
Primitive only (no strategy): a long pivot is a 3-bar low (`prev` and `next` lows higher) that is **confirmed** when a later high strictly takes out the high of the bar before the pivot. `lastConfirmedPivotLow` is the most recent such low as of a bar — for continuation stops and pivot-trail later.

```mermaid
flowchart TD
  Fractal["low prev greater than pivot greater than next"] --> Wait[Need bar i plus 2]
  Wait --> High{high k greater than high of i minus 1?}
  High -->|no| Wait
  High -->|yes| Live[Confirmed pivot low]
```

### How to test
- `npm test` — `isLongPivotCandidate`, confirm bar 4 vs equal high 11, `lastConfirmedPivotLow` null until confirm

---

## 2026-08-25 — Bunn 2.5–3R target window

### What changed
Backtest Target can exit at the **2.5R floor** of Bunn’s mechanical window (not trailing, not a 2/3/4R hard multiple). Default remains trail 50.

```mermaid
flowchart TD
  Fill[Fill and 1R] --> Mode{Target}
  Mode -->|Trail 50| Trail[Existing trail]
  Mode -->|2 3 4R| Hard[High tags NxR]
  Mode -->|2.5 to 3R window| Win[High tags 2.5R]
  Win --> Out[target_window]
```

### How to test
- `npm test` — `simulateRTrade` window exit at 2.5R; same-bar stop still wins; parse `{ trailEma: null, targetWindow: true }`
- UI: Backtest → Target → **2.5–3R window** (default still Trail 50-EMA)

---

## 2026-08-25 — Bunn bounce entry (Elite Trend Trader)

### What changed
New backtest strategy `bunn_bounce` (not the default). Encodes Frank Bunn’s fan-bounce entry: a reversal bar on the 50, 100, or 200 while `50 > 100 > 200` holds, filled at a buy stop 2¢ above the trigger, with 1R = trigger-bar height + 2¢. Management is still trail-50 / hard `targetR` so bounce can be compared to `tag50` in R.

```mermaid
sequenceDiagram
  Scanner->>Bar: reversal vs 50 or 100 or 200
  Bar->>Fan: 50 greater than 100 greater than 200
  Fan->>Stop: buy stop at high plus 0.02
  Stop->>Next: first high that reaches stop
  Next->>Risk: stop at fill minus bar height minus 0.02
  Risk->>Manage: existing trail50 or targetR
```

### How to test
- `npm test` — `isBunnLongReversal`, fill ≠ trigger close, R = height + 2¢, 100-EMA bounce without a 50 reversal, `tag50` ALGN fixture unchanged
- UI: Backtest → Strategy → **Bunn bounce** (default remains 50-EMA tag)

---

## 2026-08-25 — Rising 200-EMA lookback filter

### What changed
Lists and backtest can require the **200-day EMA to be higher than it was N trading days ago**. That is the usual “long average has been rising a while” screen (Minervini: at least ~1 month, preferably 4–5).

- Measure: `EMA200[now] > EMA200[now − N]` (not “up every single day”)
- Presets: off / **21** (1 month, default) / 63 (3 months) / 105 (5 months)
- Screener: filter bar, applied after the fan screen. Short history fails the filter.
- Backtest: same check **at the fill bar**, copied from the bar when Backtest opens

```mermaid
flowchart TD
  Fan[Fan geometry] --> Slope{EMA200 now > N bars ago?}
  Slope -->|no or too little history| Skip[Skip]
  Slope -->|yes or N = 0| Keep[Keep / fill]
```

### How to test
- `npm test` — `ema200RisingAt`, list filter, onset skip on short lookback, parse + store copy-on-open
- UI: filter bar **200-EMA slope** defaults to Rising ≥ 1 month; Backtest dropdown matches

---

## 2026-08-24 — Swing-account overlay on the fan backtest

### What changed
The backtester still scores every signal in R (strategy quality). It now also replays those fills as a **cash book**: starting capital, last N months (or until ruin), same entry/exit rules.

- Size = risk % of equity / 1R (initial stop), whole shares, capped by cash
- Max concurrent names (default 4)
- Same-day exits settle before new entries
- Entries are no longer clipped by the 40-bar forward-horizon pad, so a 3-month window actually has fills

```mermaid
flowchart TD
  Strat[findFanEntries] --> All[All R-stats]
  Strat --> Dated[Dated fills in window]
  Dated --> Size{cash and a free slot?}
  Size -->|no| Skip[Skip]
  Size -->|yes| Open[Buy shares]
  Open --> Exit[Strategy exit]
  Exit --> Eq[Mark equity]
  Eq -->|equity 0| Ruin[Stop]
  Eq -->|window end| Done[End equity]
```

### How to test
- `npm test` — `simulateFanAccount` (1R ≈ 1%, max names, same-day redeploy, window, ruin)
- UI: Backtest → set cash / risk / names / window → Run → Swing account stats + fill table

---

## 2026-08-24 — Backtest MACD / Stoch RSI + vol/cap filters

### What changed
Backtest now snapshots classic **MACD 12/26/9** and **Stoch RSI 14/14/3/3** on each fill (reference only — not an entry gate). Results show win rate / avg R by MACD hist, line vs signal, and Stoch %K zone. The trade chart adds MACD and Stoch panes. Volume and market-cap dropdowns match the main filter bar and are copied from the screener when Backtest opens. Unknown market cap still fails a cap floor, same as the list.

```mermaid
flowchart TD
  Open[Open Backtest] --> Copy[Copy minAvgVol / minMarketCap]
  Copy --> Scan[Universe scan]
  Scan --> Filt{vol and cap pass?}
  Filt -->|no| Skip[Skip name]
  Filt -->|yes| Fill[Fan fill]
  Fill --> Snap[Snapshot MACD + Stoch RSI]
  Snap --> Buckets[Correlate vs realized R]
```

### How to test
- `npm test` — universe skip on vol/cap, MACD snapshot on ramp, factor buckets, parse + store copy-on-open
- UI: set vol/cap on the filter bar → Backtest → dropdowns match → Run → factor table + MACD/Stoch panes on a trade

---

## 2026-08-24 — Setup markers, prev/next, paginated entries

### What changed
Each backtest fill now carries the setup: **fan** (first 18>50>100>200 / 18-50 cross), **high** (swing before the pullback), **tag** (the bounce/fill). The trade chart shades that window, marks those bars, and still shows entry/exit. The entry list is paged (20 rows). The review has Prev / Next across the current result list.

```mermaid
flowchart LR
  Fan[◆ fan stacked] --> High[▾ swing high]
  High --> Tag[▲ 50-tag]
  Tag --> Hold[trail / exit]
```

### How to test
- `npm test` — `fanBar` on onset, `tradeChartRange` extra bars, `stepFanTradeReview`
- UI: Backtest → run → page the table → open a row → Prev/Next. Chart should show a purple **fan** diamond before the green **tag**

---
## 2026-08-24 — Full fan at entry + four EMAs on the trade chart

### What changed
Tag/structure entries now require the uptrend fan from the image (`EMA18 > EMA50 > EMA100 > EMA200`) on the entry bar. The episode dies if that stack breaks. The trade chart draws all four EMAs and shows 80 bars before the fill (was 18/50 only, 30-bar pad).

```mermaid
flowchart TD
  Cross[18 crosses 50 while 50>100>200] --> Fan{18>50>100>200?}
  Fan -->|no| Dead[Episode ends]
  Fan -->|yes| Tag[50-EMA tag]
  Tag --> Fill[Long]
```

### How to test
- `npm test` — `fullFanUp`, ALGN 2016-02-24 rejected, `tradeChartRange` default 80/20
- UI: Backtest → run → click a row. Chart should show four stacked EMAs over a wider window

---
## 2026-08-24 — Click a backtest row for the trade chart

### What changed
Recent-entry rows open a candlestick window around that trade: entry triangle, exit square, stop/entry (and target if not trailing) lines, EMA 18/50, plus copy that explains the exit.

```mermaid
sequenceDiagram
  User->>Modal: click entry row
  Modal->>Store: inspectFanEntry
  Store->>API: GET /instrument/:ticker
  API-->>Store: bars
  Store-->>Review: Stock + FanEntryEvent
  Review->>User: candles + markers + story
```

### How to test
- `npm test` — `explainFanTrade`, `inspectFanEntry`
- UI: Backtest → run → click a row → ← Results

---

## 2026-08-24 — Default to tag50 + trail 50

### What changed
Shipped the sweep winner as the product default:

- Entry: 50-EMA tag (not full structure)
- Exit: trail the 50 after 1R breakeven
- MACD window off by default; if turned on, it filters entry only and does **not** cut a trailed trade

```mermaid
flowchart TD
  Tag[50-EMA tag] --> Fill[Long, stop + ATR pad]
  Fill --> BE{High reaches 1R?}
  BE -->|no| Stop[Stop]
  BE -->|yes| Trail[Trail 50 while slow fan holds]
  Trail -.->|MACD flip| Hold[Keep holding]
```

### How to test
- `npm test` — `src/lib/fanBacktest.test.ts`, `server/fanBacktest.test.ts`
- UI: Backtest opens on 50-EMA tag / Trail 50-EMA / MACD unchecked; click a recent-entry row for the trade chart

---

## 2026-08-24 — Fan backtest config sweep

### What changed
Ran the live engine across two datasets (kaggle 2014–17, 1,460 names; dev 2018–23, 488 names). Extra indicators scored at the entry bar only.

| Knob | Result |
|---|---|
| Default structure 3R | 0.14R / 0.22R |
| tag50 + trail 50, MACD exit off | **0.67R / 0.52R** |
| MACD as exit while trailing | Blocks the trail (43% of tag18+trail exits) |
| RSI / ADX / volume / classic MACD as entry | Do not replicate |
| StochRSI K > 80, tag >3% above EMA50 | Soft skips only |

```mermaid
flowchart LR
  Default[structure + 3R + MACD exit] -->|change exits| Trail[tag50 + trail 50]
  Trail -->|drop MACD exit| Best[0.5–0.7R both windows]
  Default -.->|add RSI/ADX| No[no replicated lift]
```

### How to test
Open the evaluation canvas beside chat. Product default is now tag50 + trail 50, MACD off; MACD does not cut a trailed trade even if re-enabled.

---

## 2026-08-24 — Entry/exit/continuation rules for fan backtest

### What changed
Research against EMA-stack / pullback literature (bone zone, MA bounce, 1R→breakeven, trail the stack) vs the old “one tag, hard 3R, time stop” engine:

| Decision | Before | Now |
|---|---|---|
| Entry | First 50-tag only, required ≥1 lower low + 2-bar reversal | 18-EMA bone-zone tag; first touch (0–2 lower lows); reversal **or** rejection wick; rising 50 filter |
| Continuation | Episode died after one fill | Re-arm on a new swing high; one open trade per name |
| Stop | Exact pullback/50 | Same structure, padded 0.25 ATR(14) |
| After 1R | Hold original stop to 3R | Default: stop → breakeven |
| Exit | Hard 2/3/4R + always-on time stop | Optional **trail 50-EMA**; time stop skipped while trailing a live slow fan |

```mermaid
flowchart TD
  Cross[18 crosses 50 while 50>100>200] --> PB[Pullback: 0-2 lower lows]
  PB --> Tag{Tag 18 or 50, close back above}
  Tag --> Conf{Reversal or bounce / MACD?}
  Conf --> Fill[Long, stop under swing + ATR pad]
  Fill --> BE{High reaches 1R?}
  BE -->|no| Stop[Stop or structure exit]
  BE -->|yes| BEStop[Stop to entry]
  BEStop --> Trail{Trail 50?}
  Trail -->|yes| Hold[Hold while stacked, trail 50]
  Trail -->|no| Target[Hard 2/3/4R]
```

### How to test
- `npm test` — `src/lib/fanBacktest.test.ts`, `server/fanBacktest.test.ts`
- UI: Backtest → 18-EMA tag / Trail 50-EMA / continuation + breakeven checkboxes

## 2026-08-24 — Structured fan strategies + 1R/3R

### What changed
Backtest is no longer only “buy fan onset.” Strategies, long-only:

1. **Fan onset** — baseline, first `18>50>100>200`
2. **Continuation cross** — 18 crosses up 50 while `50>100>200`
3. **50-EMA tag** — first bounce after that cross, ≤2 lower lows
4. **Full structure** (default) — tag + 2-bar reversal + 18–50 MACD window
5. **Dual-EMA test** — structure that trades through 18 and 50

Shared risk: 1R under `min(pullback low, EMA50)`, target 2/3/4R. Same-bar stop+target → stop (conservative). MACD line = EMA18−EMA50, signal = 9-EMA.

### How to test
- `npm test` — `src/lib/fanBacktest.test.ts`
- UI: Backtest → strategy dropdown → compare expectancy in R vs onset

## 2026-08-24 — Fan entry backtest (buy / stop / hold)

### What changed
Added a universe backtest for EMA-fan **entry signals** with simulated trade management:

- **Entry**: transition into `match` (full stack) or `near` (approaching)
- **Stop loss**: % drawdown and/or close below EMA 50/100/200
- **Continue / exit**: hold while stacked; optional exit when fan breaks; max hold bars
- **Output**: forward-return horizons (naive), simulated trade stats, recent entry table with dates

Engine: `src/lib/fanBacktest.ts`. API: `POST /backtest` (NDJSON progress + result). UI: **Backtest** button in top bar → modal.

### How to test
- `npm test` — `src/lib/fanBacktest.test.ts`, `server/fanBacktest.test.ts`
- `npm run dev` → Backtest → Run backtest

## 2026-08-24 — Volume, cap, price, and sector filters

### What changed
Added a filter bar below the top bar with dropdowns for avg volume (20d), market cap, min price, and sector. Filters apply client-side to both fan lists after search. `FanRow` now carries `avgVol20`, `relVol`, and `marketCap`. Synthetic data sets deterministic `sharesOutstanding`; imported SQLite DBs without shares leave `marketCap` null.

### How to test
- `npm test` — `src/lib/filters.test.ts`, `src/store.test.ts`
- `npm run dev` — filter bar under the top bar

## 2026-08-24 — Close-to-fan means entering, not sitting near

### What changed
Near is no longer “worst pair inverted by ≤ 0.5% on the last bar.” It is **approaching the stack after being out**:

1. not a match now
2. worst adjacent gap ≥ −0.5%
3. enough history (`n > FAN_ENTER_LOOKBACK`, 10 bars)
4. `worstGap_now > worstGap_(n − 10)` — improving, not exiting

Match is unchanged (strict `18 > 50 > 100 > 200` on the last bar). Snapshot geometry stays in `classifyFan`; the product rule is `classifyFanSeries` / `classifyCloses`.

### Architecture impact
```mermaid
flowchart TD
  Last[last-bar classifyFan] --> Match{all gaps > 0?}
  Match -->|yes| M[match]
  Match -->|no| Close{worstGap >= -0.5%?}
  Close -->|no| X[none]
  Close -->|yes| Hist{n > 10?}
  Hist -->|no| X
  Hist -->|yes| Imp{now gap > gap 10 bars ago?}
  Imp -->|yes| N[near]
  Imp -->|no| X
```

### How to test
- `npm test` — `src/lib/fan.test.ts` (entering vs exiting vs flat)
- `npm run dev` — right list = approaching the stack, not sitting near it

## 2026-08-24 — EMA-fan two-list screener

- **EMA fan** — `ema18 > ema50 > ema100 > ema200`
- **Close to fan** — not a match, but the worst adjacent pair is inverted by ≤ 0.5%, sorted closest-first

`classifyFan` / `screenFan` in `src/lib/fan.ts` own that rule. `POST /screen` returns `{ matches, near }`. The React app is two tables plus an overlay chart (candles + four EMAs). Composer UI, backtest, and the rule-based screen request are gone.

### Architecture impact
```mermaid
flowchart LR
  Yahoo[yahoo-fetch / eod-import] --> DB[(SQLite)]
  DB --> Universe[buildUniverse]
  Universe --> Fan[classifyFan]
  Fan --> API["POST /screen { matches, near }"]
  API --> UI[two lists + overlay chart]
```

```mermaid
flowchart TD
  E18[EMA18] -->|gap| E50[EMA50]
  E50 -->|gap| E100[EMA100]
  E100 -->|gap| E200[EMA200]
  E18 --> C{all gaps > 0?}
  C -->|yes| M[match]
  C -->|no, worstGap >= -0.5%| N[near]
  C -->|else| X[none]
```

The general rule engine in `src/lib/market.ts` and `src/lib/dag/` still exist for `buildStock` / golden tests; they are not on the live screen path.

### How to test
- `npm test` — includes `src/lib/fan.test.ts` and `server/screen.test.ts`
- `npm run dev` then open the app: left list = stacked fan, right list = within 0.5%
- Click a row for price + EMA overlay
- `curl -s -X POST http://localhost:8787/screen -H 'content-type: application/json' -d '{}'`
