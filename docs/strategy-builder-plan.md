# Strategy builder — implementation plan

Status (2026-09-07): **Phase 1 landed** on `feat/strategy-builder` — engine, presets, parser,
trade simulator, server/client/store plumbing, minimal modal. Parity with the old engine is
exact for all 8 presets (see "Parity baseline"). Resume at "Phase 2" below.

## Context

Today a "strategy" is one of 8 hardcoded ids (`onset`, `cross`, `tag18`, `tag50`,
`structure`, `dual_ema`, `bunn_bounce`, `bunn_cont`), each with its own detection code
in `src/lib/fanBacktest.ts`, a hand-faked schematic in `src/lib/fanExample.ts` (its
synthetic candles would not even pass the real detectors), and labels sprinkled through
UI and server. Adding or tweaking a setup means editing engine code.

Goal: **compose** a strategy as an ordered state machine of conditions (e.g. *EMA fan up
→ pullback of ≥3 candles with consecutive lower highs/lows whose last low is below the
18 → a candle whose high crosses back above the 18 → enter*), have the backtester put
**one mark per step** on each trade chart, and show a **schematic candlestick example
that grows as steps are added**.

### Decisions taken (Mikael, 2026-09-06) — do not re-open

- The builder **replaces** the 8 strategies; they become built-in presets made of steps.
  One engine serves backtest, signal scan and the example chart.
- Steps come from a **menu of parameterized step types** (no expression language).
- **Earlier steps can be invariants** (`hold`); a broken hold or an exceeded `maxWait`
  resets the machine to step 1.
- Example chart is **generated from the steps**; no hand-dragging of candles.
- **Entry / Stop / Exit are editable trade rows**, auto-added with defaults (buy-stop 2¢
  above trigger high; stop under setup low minus ATR pad; exit management = today's
  target / trail / breakeven / max-hold controls).
- Pullback knobs configurable on the step: strict lower highs AND lows, "below EMA" =
  the candle's low, may run longer than the minimum, breakout must be the very next bar.
- Builder lives **inside the backtest modal**; strategies are named and saved in
  **localStorage**.
- Step menu v1: fan up, pullback, price-vs-EMA, 18/50 EMA cross-up while 50>100>200,
  EMA tag with close back above, reversal candle on an EMA, filters (MACD 18/50
  favorable, 200-EMA rising N bars).

## Design

### 1. Data model — new folder `src/lib/strategy/`

`types.ts`

```ts
StrategyDef { id, name, description?, builtin?, steps: Step[], trade: { entry, stop, exit } }
Step = { id, hold?: boolean, maxWait?: number | null } & StepParams   // discriminated union on `type`
```

Step kinds are derived from the type: **candle** (consumes a bar, at most one per bar),
**instant** (fires on the same bar as the previous step if true, else waits), **guard**
(must be true on the bar the preceding step fired; a failing guard cancels that firing
back to the nearest preceding candle step, no reset), **tracker** (fires instantly, then
keeps state; **its bar is the swing high, so the chain ends on that bar** — no tag on the
cross bar). Only `holdable` types accept `hold`. Each type is also **anchored** or not
(its mark pins a specific bar: candles, the tracker, and `ema_cross`; `fan_up` and guards
are not) — `fanBar / impulseBar / reactionBar` derive from anchored marks only.

| type | kind | params | fires when |
|---|---|---|---|
| `fan_up` | instant, holdable | `mode: 'full' \| 'slow'` | 18>50>100>200 (full) or 50>100>200 (slow) |
| `fan_onset` | candle | `entry: 'match' \| 'near'` | fan status transitions into `entry` (`classifyFanAtIndex`) |
| `ema_cross` | **instant**, holdable, anchored | `fast 18, slow 50, dir up/down, require none/slow_fan/full_fan` | fast crosses slow (+ require at i). A cross is an indicator event, not a candle shape, so it does not consume the bar: a reversal candle or a tag can fire on the cross bar (this is what keeps `bunn_cont` at parity). **Hold is lagged one bar**: up → `e18[i-1] > e50[i-1]`, down → `e18[i-1] < e50[i-1]`, so the opposite cross can fire before the hold breaks; a later opposite `ema_cross` on the same pair *releases* the hold |
| `pullback` mode `run` | candle | `minBars, lowerHighs, lowerLows, belowEma 18/50/100/null, belowField low/close, nextBarOnly` | run of ≥ minBars consecutive lower-high/lower-low bars whose last bar is below the EMA; `extends(i)` keeps the run alive while the next step waits |
| `pullback` mode `swing` | tracker | `maxLowerLows (0–2), rearmOnNewHigh` | fires instantly on the previous step's bar (`swingHigh = h[i]`); tracks swing high / pullback low / lower-low count; count > max resets; new swing high re-arms after an entry (old `continueEpisode`) |
| `price_vs_ema` | candle, holdable | `ema, field high/close/low, dir above/below` | field vs EMA on the bar |
| `ema_tag` | candle | `ema 18/50, throughEma null/18, confirm none/reversal_or_bounce` | `l ≤ ema ≤ c` (+ `h ≥ e18` for dual; + `isLongReversal ‖ isMaBounce(ema)` for structure) |
| `reversal_candle` | candle | `emas (50/100/200)[], style bunn/ma_bounce, refresh` | Bunn reversal (or MA bounce) on any listed EMA; `refresh` = while the next step waits, a later reversal replaces the mark (latest wins) |
| `macd_favorable` | guard | – | 18–50 MACD line > signal and hist ≥ 0 |
| `ema_slope` | guard, holdable | `ema, lookback` | `ema[i] > ema[i-lookback]` |

Trade rows:

```ts
EntrySpec { mode: 'buy_stop' | 'close', offset: 0.02, maxWait: number | null }
StopSpec  { anchor: 'setup_low' | 'trigger_low' | 'mark_low', stepId?, underEma50: boolean, atrPad: 0.25, offset: 0 }
ExitSpec  { targetR, targetWindow, trailEma, trailPivot, breakevenAtR, maxHoldBars, macdExit, fanExit: 'slow' | 'full' }
```

`FanBacktestConfig` becomes `{ strategy: StrategyDef, horizons, minAvgVol, minMarketCap,
ema200RisingBars, startCash, riskPct, maxPositions, windowMonths }`. The old flat fields
`entry`, `macdWindow`, `continueEpisode`, `targetR`, `trailEma`, `trailPivot`,
`targetWindow`, `breakevenAtR`, `maxHoldBars`, `stopAtrMult` move into steps / trade
rows. `ema200RisingBars` stays on the config (copied from the filter bar; applied by the
engine at the fill bar, as today).

`FanEntryEvent`: `strategy: FanStrategyId` → `strategyId, strategyName, entryMode,
summary`; drop `signal`; add `marks: StrategyMark[] { stepId, stepIndex, kind, label,
bar, price }`; keep `fanBar / impulseBar / reactionBar` **derived from candle+tracker
marks only** (first / highest-high / last) so `tradeChartRange` and `explainFanTrade`
keep working. Clamp `tradeChartRange` extras to `>= entryBar − 160` (a `fan_up` hold can
fire hundreds of bars before the entry and would open a huge default window).

### 2. Engine — `src/lib/strategy/engine.ts`

`findStrategyEntries(subject, config, { trace? }): FanEntryEvent[]`

Series computed once per subject (reuse `ema`, `macd1850`, `atr14`, `classicMacd`,
`stochRsi`). Scan start = `EMA_WARM` (200) + `FAN_ENTER_LOOKBACK` (10) only when a
`fan_onset{near}` step exists; `if (L < start + 2) return []`; loop `i < L-1`;
`fan_onset` seeds `status(start-1)`. Universal gates kept verbatim: `ema200RisingAt` at
the fill bar, one open trade per name (`lastExit`), `MIN_R_FRAC` rejection.

Per bar, in this order:

```
1. HOLDS  — for every fired step with hold: if !holds(i) → reset('hold', step); the chain
            still runs on this bar from step 1 (a reset never blinds the machine to the bar
            that caused it — an 18/50 whipsaw re-crosses down on the bar the lagged hold breaks)
2. TRACKER — if swing tracker active:
     h[i] >= swingHigh → swingHigh=h[i], swingHighBar=i, lowerLows=0, lastLow=pullbackLow=l[i],
                         armed = true if rearmOnNewHigh or not yet taken; move tracker mark; skipEvents=true
     else l[i] < lastLow → lowerLows++, lastLow=l[i], pullbackLow=min(pullbackLow,l[i])
     lowerLows > maxLowerLows → reset('lower_lows'); next bar
3. PENDING buy stop — if set: h[i] >= buyStop → (i > lastExit && ema200 gate) ? enter(i, fill=buyStop) : drop;
     then afterEntryReposition(); else if maxWait exceeded → drop + reset; next bar (nothing else fires while pending)
4. if i <= lastExit or skipEvents → next bar (track only during an open trade / new-high bar)
5. REFRESH — prev step has refresh and fires(i) → move its mark to i (does not consume the bar)
6. FIRE CHAIN — candleUsed=false; while cur:
     cur is candle && candleUsed → break
     tracker present && !armed && cur.index > trackerIdx → break        (parked until re-arm)
     !cur.fires(i):
        cur is guard → cancel back to nearest preceding candle step (never past a live tracker); break
        prev step extends(i) → move prev mark to i, lastFireBar=i; break   (pullback run keeps running)
        cur.maxWait != null && i - lastFireBar >= maxWait → reset('max_wait', cur); break
        else break (wait)
     push mark {stepId, stepIndex, kind, bar:i, price}; candle → candleUsed=true
     tracker step → init tracker state; cursor++; lastFireBar=i
     cursor == steps.length → trigger(i); break
     tracker step → break (its bar is the swing high)

trigger(i): entry.mode=='close' → ema200 gate && enter(i, fill=c[i]) ? afterEntryReposition()
                                   : cancel back to the nearest candle step (retry next bar)
            else pending = { trigBar:i, buyStop: h[i]+offset, maxWait }          (fills from i+1)
enter():   stop = stopPriceOf(...); rSize = fill-stop; reject if !(rSize>0) || rSize/fill < MIN_R_FRAC
           target = fill + (exit.targetWindow ? 2.5 : exit.targetR) * rSize
           sim = simulateRTrade(bars, emas, macd, i, stop, target, exit, fill)
           push event { barIndex:i, marks: copy, trade, indicators, forwardReturns, derived fanBar/impulseBar/reactionBar }
           tracker.taken = true; lastExit = sim?.exitBar ?? i
afterEntryReposition(): tracker ? (armed=false, cursor=trackerIdx+1, marks.length=trackerIdx+1) : reset('taken')
stopPriceOf(): base = trigger_low ? l[trigBar] : mark_low ? l[mark(stepId).bar]
                    : setup_low = min(l[k]) for k in [tracker?.swingHighBar ?? firstCandleMark.bar .. i]
               if underEma50: base = min(base, e50[i]);  return base − atrPad·atr14[i] − offset
```

`trace: true` records every reset/cancel `{ bar, step, reason }`; the example pane uses
it to explain why a step never fired.

Known non-parity with the old code (accepted, none of it affects the default presets): the
Bunn presets checked MACD at the fill bar (now a guard on the trigger bar; only when the
MACD checkbox is on); a guard-cancelled tag no longer retries on the same bar (the guards in
the presets are stateless, so this changes nothing measurable). Everything else — including
a bounce on the cross-down bar and a resume on the bounce bar — is reproduced exactly.

### 3. Presets — `src/lib/strategy/presets.ts` (ids unchanged; names/hints from today's `FAN_STRATEGIES`)

| id | steps | entry | stop | exit.fanExit |
|---|---|---|---|---|
| onset | `fan_onset{match}` | close | trigger_low, underEma50, pad .25 | **full** |
| cross | `ema_cross{up, slow_fan}` | close | trigger_low, underEma50, pad .25 | slow |
| tag18 / tag50 / structure / dual_ema | `ema_cross{up, slow_fan}` → `fan_up{full, hold}` → `pullback{swing, 2, rearm}` → `ema_tag{18 \| 50 \| 50+confirm \| 50+through18+confirm}` → `ema_slope{50, 5}` | close | setup_low, underEma50, pad .25 | slow |
| bunn_bounce | `fan_up{slow, hold}` → `reversal_candle{[50,100,200], bunn}` | buy_stop .02 | trigger_low, pad 0 | slow |
| bunn_cont | `ema_cross{down, slow_fan, hold}` → `fan_up{slow, hold}` → `reversal_candle{[100,200], bunn, refresh}` → `ema_cross{up, full_fan}` | buy_stop .02 | mark_low(reversal), offset .02, pad 0 | slow |

Also `DEFAULT_ENTRY / DEFAULT_STOP / DEFAULT_EXIT`, `presetById`, `resolveStrategy(id,
saved)`, `strategyNameOf`, `newCustomStrategy`.

### 4. Parser — `src/lib/strategy/parse.ts` (shared by server and localStorage load)

`parseStrategyDef(unknown)` throws `StrategyParseError`: unique step ids, known types,
params coerced via each type's `paramSchema`, `hold` only on holdable types, at most one
tracker, ≤ 12 steps, `mark_low.stepId` must exist, name ≤ 60 chars, trade rows coerced
with the same rules as today's `parseFanBacktestBody`. `parseStrategyRef` accepts a
preset id string **or** a def object (keeps `/signals` bodies small for presets).

### 5. Example chart — `src/lib/strategy/example.ts` replaces `fanExample.ts`

A `Sketch` builder synthesizes bars with **real incremental EMAs** (same recurrence as
`indicators.ts` `ema`, seeded on the first close, so `ema()` over the closes reproduces
them exactly): a 230-bar warm-up ramp (~+0.3%/bar with a small wobble) gives a genuine
stacked fan, then one sketcher per step type shapes candles relative to the running EMA
values (fan_up: ramp until true; fan_onset: dip then ramp until the status matches;
ema_cross up: −0.5%/bar until 18 < 50 then +0.7%/bar until the cross; pullback swing:
~6 impulse bars making higher highs; pullback run: `minBars` lower-high/lower-low bars,
last `belowField` placed under the EMA; price_vs_ema: one bar 0.5% past the EMA;
ema_tag: a red bar then a tag-and-close-above bar; reversal_candle: drift to the EMA then
a hammer through it and the prior low; guards add nothing), then the entry bar(s)
(`buy_stop` → one bar with `h = trigHigh + 0.05`) and a 14–16 bar exit run shaped by
`ExitSpec`, plus 3 tail bars. The **real engine** is then run over the synthetic subject
(`minAvgVol/minMarketCap` zeroed, `trace: true`); its marks, trade, stop/target levels
and phases (one per step, from the previous mark to this mark) drive the chart. If no
entry is found, the pane shows which step failed and why — this doubles as feedback for
contradictory strategies. Rendered window: first candle mark − 6 … exit + 3.

`FanExampleChart.tsx` is generalized: marks drawn by kind with the step index in the
label, a failure panel, notes from `describeStrategy`.

### 6. UI — `src/components/modals/StrategyBuilder.tsx` (new), modal + filter bar

- Replaces the strategy `<select>` block in `FanBacktestModal.tsx` (currently lines
  143–247): picker (presets group + saved group; Save / Save as / Delete / Reset to
  preset; an edited preset becomes dirty and must be saved under a new name), step cards
  (type, params generated from `paramSchema`, hold checkbox disabled when not holdable,
  max wait, up/down/remove), add-step menu, and the three trade rows. The Exit row hosts
  the Target / Max hold / Breakeven / MACD-exit controls moved out of the modal. Inline
  validation from `parseStrategyDef`.
- Right column keeps the example chart and adds a per-step check list (✓ bar N / ✗ reason).
- Same inline-style conventions as the modal (`label` / `field` / `card` consts,
  `HButton`, `Disclosure`). The `ui/` kit has no Select/NumberInput; keep raw elements.
- `FilterBar.tsx` strategy options = presets + saved (memo from store state, not the
  module-level `STRATEGY_OPTIONS`); `FanLists.tsx` header uses `strategyNameOf`.

### 7. Persistence and store

- `src/lib/strategy/storage.ts`: key `stockScreener.strategies.v1`, `loadStrategies` /
  `saveStrategies`, guards `typeof localStorage === 'undefined'`, try/catch, each entry
  re-parsed, invalid entries dropped, preset ids ignored.
- `store.ts`: `makeScreenerState(client, storage?)` (injectable; `src/store.test.ts` runs
  in Node with no storage shim), `strategies: StrategyDef[]`, `saveStrategy`,
  `deleteStrategy` (clears `signalStrategy` / resets config to `tag50` if selected),
  `setStrategyDef`, `patchExit`. `signalStrategy` stays a string id (`''` = off) and is
  resolved to a def in `runSignals`, so the `!==` identity guard at `store.ts:289` keeps
  working.

### 8. Server

- `server/fanBacktest.ts` / `server/signals.ts`: `parseStrategyRef` replaces the two
  duplicated `STRATS` arrays; `StrategyParseError` is rethrown as `RequestError` (defined
  in `server/handlers.ts`; `src/lib` must not import it) so `/backtest` and `/signals`
  return a JSON 400. Parsing already precedes `res.writeHead` in `server/index.ts`.
  Unknown strategy no longer silently becomes `tag50`; the legacy `entry:'match' → onset`
  mapping goes away.
- `SignalsRequest.strategy: string | StrategyDef`; response echoes id + name.
- `fanSignals.ts`: `signalScanConfig(def, filters)` splices the unmanaged 3R exit
  (`targetR 3, targetWindow false, trailEma null, trailPivot false, breakevenAtR null,
  maxHoldBars null, macdExit false`) into `def.trade.exit`, keeping `fanExit`.

### 9. Module layering (avoids an ESM cycle / TDZ)

```
indicators, fan
  → strategy/primitives   (predicates + constants moved verbatim from fanBacktest.ts:
                           BUNN_PENNY/WINDOW_LO/HI, EMA_WARM, MIN_R_FRAC, macd1850, slowFanUp,
                           fullFanUp, crossUp/Down18_50, isLongReversal, isBunnLongReversal,
                           isLongPivotCandidate, longPivotConfirmBar, lastConfirmedPivotLow,
                           isMaBounce, atr14, slopeUp, statusAt, macdFav, snapshotIndicators)
  → strategy/trade        (simulateRTrade + finish, reading ExitSpec; FanSimulatedTrade types)
  → strategy/steps        (STEP_TYPES registry: label, kind, holdable, defaults, describe, paramSchema; compileSteps)
  → strategy/presets, strategy/parse
  → strategy/engine
  → fanBacktest.ts, fanSignals.ts   (fanBacktest.ts re-exports primitives + trade so the
                                     30 test imports in fanBacktest.test.ts keep resolving)
```

No `strategy/*` file imports `fanBacktest.ts` at runtime (type imports only).
`DEFAULT_FAN_BACKTEST_CONFIG.strategy = presetById('tag50')` must not be evaluated
before presets' own imports (hence the layering).

## Phases

Each phase green on `npm run typecheck && npm run test && npm run lint` before the next;
one commit each.

**Phase 1 — engine and plumbing.** ✅ landed 2026-09-07. Create `types.ts`, `primitives.ts`, `trade.ts`,
`steps.ts`, `presets.ts`, `parse.ts`, `engine.ts`. In `fanBacktest.ts` delete the 8
detectors, `maybeEnter`, `scanStart`, `ENTRY_STORY`, `FAN_STRATEGIES`, `FanStrategyId`;
rewrite `FanBacktestConfig`, `FanEntryEvent`, `explainFanTrade` (entry sentence from
`entryMode` + `summary`, keeping the phrases the tests grep for: "50-EMA", "buy stop",
"adversely crossed", "N bars earlier"). Update `fanSignals.ts`,
`server/{fanBacktest,signals,handlers}.ts`, `marketClient.ts`, `store.ts`, and minimally
`FanBacktestModal.tsx` (select over presets, exit controls via `patchExit`, MACD
checkbox toggles `macdExit` + a trailing `macd_favorable` guard step, continuation
checkbox toggles the tracker's `rearmOnNewHigh` and is disabled when the def has no
tracker), `FanTradeReview.tsx` (`trailEma` from the def), `FilterBar.tsx`,
`FanLists.tsx`. Temporary adapter in `fanExample.ts` (`legacyIdOf(def)` + flat exit
fields from `def.trade.exit`) so it compiles until phase 3.

**Phase 2 — marks in the trade review.** `FanTradeReview.tsx`: replace the setup band,
`markLine` / `diamond` / `high` triangle and the `'fan / tag'` label with a loop over
`event.marks` (dashed line + glyph per kind + label), setup band from first candle mark
to entry, legend built from marks; clamp in `tradeChartRange`.

**Phase 3 — generated example.** `example.ts` + generalized `FanExampleChart.tsx`;
delete `fanExample.ts` and `fanExample.test.ts`.

**Phase 4 — builder UI, persistence, docs.** `StrategyBuilder.tsx`, `storage.ts`, store
actions, `FilterBar` options, development-diary entry (`## 2026-09-xx — Strategy
builder replaces the fixed fan strategies`, mermaid `StrategyDef → parse → engine →
{/backtest, /signals, example}` flow, "How to test").

## Parity baseline (captured before any engine change)

Old `findFanEntries` output per strategy over the synthetic universe (`syntheticProvider(7)`,
44 names), `dev-market.db`, and the ALGN fixture, default config with `horizons: [5]`:

| strategy | entries | names |
|---|---|---|
| onset | 3725 | 497 |
| cross | 2071 | 477 |
| tag18 | 1009 | 396 |
| tag50 | 549 | 311 |
| structure | 347 | 228 |
| dual_ema | 327 | 217 |
| bunn_bounce | 6432 | 507 |
| bunn_cont | 839 | 412 |

**Result (2026-09-07, phase 1):** the new engine reproduces every row above exactly — same
entry bars, entry prices, stops, exit bars and exit reasons for all 14,899 entries across the
8 presets. Two engine details were needed to get `bunn_cont` from 737/839 to 839/839:
`ema_cross` is an instant (non-consuming) step, and a hold reset lets the chain run on the
same bar.

The per-entry dump (`barIndex, entryPrice, stop, exitBar, exitReason, fanBar, impulseBar,
reactionBar` per ticker) lived in the session scratchpad and is **not** kept. Regenerate
it on `main` (or any commit before the engine changes) with the script below, keep the JSON
outside the repo, then re-run the same script against the new engine (swap
`findFanEntries` for `findStrategyEntries` with `presetById(strategy)`) and diff the
`barIndex` sets per ticker. Investigate anything beyond the documented non-parity.

```ts
// baseline.ts — run with: node baseline.ts out.json   (Node 24 strips types)
import { writeFileSync } from 'node:fs';
import { buildUniverse } from '<repo>/src/lib/market.ts';
import { syntheticProvider } from '<repo>/src/lib/data/synthetic.ts';
import { sqliteProvider } from '<repo>/src/lib/data/sqlite.ts';
import { findFanEntries, subjectFromStock, DEFAULT_FAN_BACKTEST_CONFIG } from '<repo>/src/lib/fanBacktest.ts';
import algn from '<repo>/src/lib/testdata/algn-unstacked-tag50.json' with { type: 'json' };

const STRATS = ['onset', 'cross', 'tag18', 'tag50', 'structure', 'dual_ema', 'bunn_bounce', 'bunn_cont'] as const;
const out: Record<string, Record<string, unknown[]>> = {};
const sources: Record<string, ReturnType<typeof buildUniverse>> = {
  synthetic: buildUniverse(syntheticProvider(7).getUniverse()),
};
try { sources.dev = buildUniverse(sqliteProvider('<repo>/dev-market.db').getUniverse()); } catch (e) { console.error('dev db skipped', (e as Error).message); }
const algnSubject = { ticker: algn.ticker, name: algn.name, closes: algn.closes, opens: algn.opens, highs: algn.highs, lows: algn.lows, dates: algn.dates };
const row = (e: any) => [e.barIndex, +e.entryPrice.toFixed(4), e.trade ? +e.trade.stopPrice.toFixed(4) : null, e.trade?.exitBar ?? null, e.trade?.exitReason ?? null, e.fanBar, e.impulseBar, e.reactionBar];
for (const strategy of STRATS) {
  out[strategy] = {};
  const cfg = { ...DEFAULT_FAN_BACKTEST_CONFIG, strategy, horizons: [5] };
  for (const [src, uni] of Object.entries(sources)) {
    for (const s of uni) {
      const evs = findFanEntries(subjectFromStock(s), cfg);
      if (evs.length) out[strategy][`${src}:${s.ticker}`] = evs.map(row);
    }
  }
  const evs = findFanEntries(algnSubject, cfg);
  if (evs.length) out[strategy]['algn'] = evs.map(row);
  console.log(strategy, Object.values(out[strategy]).reduce((a, b) => a + b.length, 0), 'entries in', Object.keys(out[strategy]).length, 'names');
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
```

## Tests

- `strategy/engine.test.ts` (new): ported cases from `fanBacktest.test.ts` (onset ramp
  `rampSeries(200, 90)`, bunn_bounce via `stackedOhlc()` mutations, bunn_cont via
  `continuationOhlc()` + `adverseResumeOf()`, setup bars, 200-EMA gate, classic MACD
  snapshot, exit dates, ALGN regression `testdata/algn-unstacked-tag50.json` — fullFanUp
  must hold at every tag50 entry and 2016-02-24 must not be taken) via presets; new cases:
  swing re-arm (2 entries vs 1), three lower lows → 0, hold reset with trace reason, guard
  cancel keeps earlier marks, pullback run + `nextBarOnly` (breakout next bar → entry with
  one mark per step; two bars later → 0; run extends then breaks out → mark on the
  extended bar), pending buy stop dies on hold break / fills at high+0.02, reset after
  entry for non-tracker strategies, no tag on the cross bar, `marks.length ===
  steps.length` and `marks[i].stepIndex === i` for every preset.
- `strategy/parse.test.ts`: round-trips every preset; rejects unknown type, duplicate ids,
  hold on `ema_tag`, missing `mark_low.stepId`, > 12 steps; accepts an id string.
- `strategy/trade.test.ts`: the `simulateRTrade` describe moved, configs as `ExitSpec`
  (`macdWindow` → `macdExit`, `fullFanExit` → `fanExit`).
- `strategy/example.test.ts`: every preset → `failure === null`, exactly one engine entry,
  step marks `[0..n-1]`, contiguous phases (`phases[i].from === phases[i-1].to + 1`); a
  contradictory strategy names the failing step; trail/target/window level assertions
  ported from `fanExample.test.ts`.
- `strategy/storage.test.ts`: round-trip with a memory storage, corrupt JSON ignored,
  preset ids ignored.
- Files to update: `src/lib/fanBacktest.test.ts` (config literals, `FAN_STRATEGIES`
  tests, `sampleEvent` shape, `DEFAULT` test → `config.strategy.id === 'tag50'` and
  `trade.exit.trailEma === 50`), `src/lib/fanSignals.test.ts` (`signalScanConfig(presetById('onset'))`,
  drop `strategyLabel`), `server/fanBacktest.test.ts` (preset id, def object, invalid def
  → 400; POST body `{ strategy: 'onset', horizons: [5] }`; drop the legacy `entry:'match'`
  case), `src/store.test.ts` (fake `config` literal → `{ ...DEFAULT_FAN_BACKTEST_CONFIG,
  horizons: [5] }`; signals fake echoes `typeof body.strategy === 'string' ? body.strategy
  : body.strategy.id`; event literals get `strategyId/strategyName/marks/entryMode/summary`),
  `src/lib/client/marketClient.test.ts` (config literal). `tests/__snapshots__/engine.golden`
  is unaffected (indicators untouched).

## Verification

- After every phase: `npm run typecheck`, `npm run test`, `npm run lint`.
- After phase 1 with `npm run dev`:
  ```bash
  curl -s localhost:8787/backtest -H 'content-type: application/json' -d '{"strategy":"tag50","horizons":[5]}' | tail -1 | head -c 300
  curl -s localhost:8787/backtest -H 'content-type: application/json' -d '{"strategy":{"steps":[]}}'   # expect 400 JSON
  ```
  Compare the entry counts with the baseline table above (same DB, default config).
- UI walkthrough (phase 4): every preset shows an example with N step marks + entry/exit;
  Target → "Trail 50-EMA" makes the example exit follow the 50; run tag50 and compare
  counts; open a trade → one mark per step; build "fan_up full (hold) → pullback run 3
  below 18 → price_vs_ema high above 18 (maxWait 1)", see the example, run it, save it,
  reload → still listed; select it in the filter bar → `/signals` body carries the def and
  the list header shows its name; delete it → filter bar falls back to fan lists; add a
  contradictory step → right pane names the failing step.

## Risks

- **Parity drift on the tag presets** → baseline diff above + ALGN regression are the gate.
- **Example sketch not passing the real engine** (why the old one was faked) → sketchers
  read the running EMAs; per-preset `failure === null` test is the gate.
- **ESM cycle / TDZ** → the layering in §9.
- **Node `localStorage`** → injectable storage + `typeof` guard.
- **Modal size** (`FanBacktestModal.tsx` is 668 lines of inline styles) → builder in its
  own file; exit controls move into it.

## Reference: where the old behaviour lives (for porting)

- `src/lib/fanBacktest.ts`: episode engine `findFanEntries` 610–699 + `maybeEnter`
  579–608; `findOnset` 853–881; `findBunnBounce` 713–760; `findBunnCont` 771–851;
  `pushEntry` 883–925 (stop = `setup.stopPrice ?? min(stopHint, e50) − stopAtrMult·ATR`);
  `simulateRTrade` 474–555 (only strategy coupling is the `fullFanExit` boolean);
  `ENTRY_STORY` 1256; `explainFanTrade` 1274; `tradeChartRange` 1305.
- `src/lib/fanSignals.ts`: `signalScanConfig` 75–94; `currentOpenEntry` 97; `strategyLabel` 66.
- `server/fanBacktest.ts` `parseFanBacktestBody` 19–58; `server/signals.ts` 14–31;
  `server/index.ts` `/signals` 167–177, `/backtest` 179–203 (1 MiB body cap).
- `src/store.ts`: `signalStrategy` uses at 120, 138, 190, 256, 260, 264, 289;
  `setFanBacktestConfig` 453; `openFanBacktest` copies filters 423–446.
- `src/components/modals/FanBacktestModal.tsx`: strategy select 145–156, hint 79/215,
  continuation checkbox 229–237, exit controls 158–247, example chart 639.
- `src/components/modals/FanTradeReview.tsx`: setup bars 78–87 / 117–120, band 189–196,
  marks 240–284, entry label 319.
- `src/lib/fanExample.ts`: `segsOf` 125, `stackedEmas` 185 (fabricated EMAs),
  `closePath` 234, `ohlcOf` 267, marks 393–418.
