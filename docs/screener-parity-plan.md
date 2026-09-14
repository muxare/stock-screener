# Screener parity — implementation plan

Status (2026-09-08): **complete — phases 1–4 landed** (columns and sorting; filter clauses
and chips; view tabs and the docked chart; saved screens). Closes the gap between Screenr and a TradingView-style
screener (reference: Mikael's "Ema fan fundamental" screen, 2026-09-08). **Fundamental data is
out of scope** for this plan; everything below is computable from the OHLCV bars already in the
SQLite datasets. Builds on `feat/strategy-builder`; land that branch first.

## Context

The comparison against TradingView found six gaps that are UI or indicator work, not data work:

1. Filters are six fixed dropdowns with preset values. TradingView has an open list of
   field chips with free numeric ranges (both bounds) and a "+" to add any field.
2. RSI, Stoch RSI, volatility and change % are computed for the detail chart but not
   screenable.
3. Tables are unsortable static grids with a fixed column set; no volume, relative volume,
   market cap or sector column even though the row already carries them.
4. Rows are 44 px in a two-column split, so each table shows ~22 names and has no room for
   more columns.
5. The detail chart is a modal drawer that covers the list; you cannot scan while charting.
6. A filter set cannot be named, saved or reloaded (strategies can, filters cannot).

What Screenr already has and keeps: the EMA-fan columns and worst-gap, the "Close to fan"
list, the 200-EMA slope filter, entry strategies, the backtester, the step builder and the
hover help system (`src/help/`).

### Where things live today

- `server/screen.ts` → `screenFan(universe)` in `src/lib/fan.ts`; `toRow` builds a `FanRow`
  from the subject's closes. The server returns **every** match/near row; filtering is
  client-side in `src/lib/filters.ts` (`applyFanFilters`, `filterFanRows`).
- `FanRow` already carries `avgVol20`, `relVol`, `marketCap`, `sector`, `changePct`,
  `ema200Ago`. `FanSignalRow` carries `avgVol20`, `marketCap`, `price`, `changePct`.
- `/signals` takes three server-side floors (`minAvgVol`, `minMarketCap`,
  `ema200RisingBars`) because the scan is expensive; sector/price/search are then applied
  client-side (`filterSignalRows`).
- `src/lib/indicators.ts` exports `ema`, `sma`, `rsi`, `stochRsi`, `macd` and (since
  phase 1) `atr14`.
- Persistence pattern: `src/lib/strategy/storage.ts` (injected storage, re-parse on load,
  drop bad entries) with `store.ts` owning the list.
- `src/store.ts` is 585 lines; new state must go in its own modules.

*(Superseded by phase 1: the hard-coded `GRID` / `SIG_GRID` tables and the unused
`@tanstack/react-table` dependency are gone. See "What phase 1 actually built" below.)*

### What phase 1 actually built (read before starting phase 2)

Phase 1 landed on `feat/screener-parity-phase1`. Where it differs from the sketch below,
**this section wins** — the sketch is what was imagined, this is what exists.

- **`lib/screen/snapshot.ts`** — as designed, plus `stochD`. Two rules the design did not
  pin down and phase 2 must respect:
  - `stochK` / `stochD` stay **missing until the whole 14-bar RSI window is real**
    (`closes.length > 2 × 14`). Earlier than that the window is backfilled warm-up copies
    and %K collapses to a fake 0 — which is exactly the value a "Stoch K ≤ 20" chip would
    have matched.
  - `rsi14` needs `closes.length > 14`; `perf1m` / `perf3m` need the lookback; `atrPct`
    needs highs **and** lows of matching length; `hi52` / `lo52` fall back to closes.
- **`lib/screen/fields.ts`** — the registry, with a wider `kind` union than sketched:
  `text | enum | number | price | percent | ratio | compact | spark | bars`. `FieldDef` is
  `{ id, label, kind, get, help?, align, width, defaultVisible, column, filterable, pinned?,
  digits?, title?, options? }`. Two flags, not one: **`column`** (may be shown as a column)
  and **`filterable`** (may be a chip). `width` is a CSS grid track (`'84px'`,
  `'minmax(120px, 1fr)'`), not a number. `options` is declared but unimplemented — phase 2
  wires sectors from store facts into it.
- **`lib/screen/format.ts`** (new, not in the sketch) — `fmtCompact` moved here out of
  `lib/filters.ts` (re-exported from there), plus `fmtPercent` / `fmtRatio` / `fmtFixed` /
  `isNum` / `DASH`. **`parseCompact` belongs here in phase 2**, not in the filter module.
- **`lib/screen/columns.ts`** (new) — `ScreenView`, `DEFAULT_COLUMNS`, `orderColumns`,
  `toggleColumn`. Phase 4 adds the `sanitizeColumns` that saved screens need (drop unknown
  ids, keep pinned); it was deliberately not written on spec.
- **`lib/screen/sort.ts`** — `SortState.field` is a **`SortKey` (string), not a `FieldId`**,
  because the entries list's own columns sort through the same code. `sortRows(rows, sort,
  valueOf, tiebreak)` takes an injected accessor. Phase 4 therefore persists sort keys like
  `'barsAgo'` and must tolerate a key that no longer resolves.
- **`components/table/ScreenTable.tsx`** — generic over `T extends ScreenRowLike`; signal-only
  columns arrive as `extra: ExtraColumn<T>[]` with their own `render` and `sortValue`, placed
  by `extraAfter="changePct"`. Wide column sets scroll sideways inside the panel (`minWidth`
  from the tracks) — phase 3's full-width table is what removes the need.
- **`components/table/ColumnChooser.tsx`** — the ⚙ sits in the **list section header**, not
  inside the sticky column header row as sketched (the header row is too cramped and scrolls
  horizontally). Keep it there when phase 3 introduces the view tabs.
- **Store** — `columns: Record<ScreenView, FieldId[]>` and `sort: Record<ScreenView, SortState>`
  with `setSort` / `toggleColumn` / `resetColumns`, still in `store.ts` (~30 lines).
  `ScreenView` is **`'fan' | 'entries'`** — the *table shape*, which `near` shares with `fan`.
  That is a different axis from phase 3's visible tab and phase 4's `SavedScreen.view`
  (`'fan' | 'near' | 'entries'`), which is the *row set*. Do not merge the two.
- **Help** — `rsi`, `stoch-rsi`, `volume`, `rel-vol`, `perf`, `atr-pct`, `column-chooser` and
  `week52` (extra) are in. Still owed: `filter-chip` (phase 2), `detail-dock` (phase 3),
  `saved-screen` (phase 4).

### What phase 2 actually built (read before starting phase 3 or 4)

Phase 2 landed on `feat/screener-parity-phase2`. Where it differs from the sketch below,
**this section wins**.

- **`lib/screen/filters.ts`** — the clause model as designed. `ScreenFilters` is
  `{ clauses: Clause[] }` in **insertion order** (the order chips were added), not registry
  order; one clause per field, and `setClause` replaces rather than appends a second.
  `lib/filters.ts` is **gone** — `FanFilters`, `DEFAULT_FAN_FILTERS`, `filtersActive`,
  `applyFanFilters` and `filterFanRows` no longer exist, and the four preset arrays
  (`AVG_VOL_PRESETS` …) moved here, still shaped as `{label, value}` selects because
  `FanBacktestModal` uses them as selects.
- **`FilterRow`** = `ScreenRowLike` plus an optional `ema200Ago`. The `bars` clause **passes
  a row that has no `ema200Ago`** instead of dropping it — that is how entries rows survive
  the slope chip, since the engine already enforced the slope at the fill. Anything that
  later gives signal rows an `ema200Ago` changes that behaviour silently.
- **Clause values are stored in native units**, always. `parseFieldInput` / `formatFieldInput`
  (over `toNative` / `fromNative`, keyed on `FieldDef.kind`) are the only conversion, and
  `unitHint` supplies the editor's `%` / `e.g. 400K, 1.2B` label. Phase 4 therefore persists
  native numbers and needs no unit handling of its own.
- **`clausesActive` is not a dirty check.** It answers "does this set trim the lists relative
  to the default", so the default slope clause and any clause with no bounds set both count
  as *inactive*. Phase 4's `Save` must compare against the saved copy, not call this.
- **The re-scan rule is computed, not listed.** `createScreenSlice(set, get, onFloorsChanged)`
  compares `signalFloorsOf` before and after every filter change and calls back only when
  `floorsEqual` says a floor moved. The old hand-maintained `scanKeys` array is gone, so a
  new filterable field needs no wiring — and phase 4 loading a saved screen through
  `setFilters` re-scans exactly when it should.
- **`store/screenSlice.ts`** owns `search`, `filters`, `columns`, `sort`,
  `filteredMatches` / `filteredNear`, and `DEFAULT_SORT` (which **moved out of `store.ts`**,
  though `store.ts` still re-exports it). It reads `matches` / `near` through `get` as
  declared deps it does not own. `view` (phase 3) and `screens` / `activeScreenId` /
  `dockWidth` (phase 4) go in here too; `store.ts` should gain nothing but the slice import.
- **`filteredMatches` / `filteredNear` are still unused by the UI.** `FanLists.tsx` computes
  its own `filterRows(...)` in a `useMemo` because it also needs the unfiltered totals for
  the "n of m shown" line. Phase 3 renames that file — pick one of the two paths then rather
  than carrying both.
- **`fields.ts` gained `setSectorOptions`**, a module-level source wired once at the bottom of
  `store.ts` to the app store's `sectors`. A test store does not set it, so `options()` is
  empty under test — do not build a phase-4 test that depends on sector choices.
- **`filterSignalRows(rows, search, filters)`** — the third parameter is now the whole
  `ScreenFilters`; it is a thin wrapper over `filterRows`.
- **`components/filters/`** — `FilterChip.tsx` (chip + the three editors), `FieldPicker.tsx`
  (the `+`, with a type-ahead) and `useDismiss.ts` (outside-click / Esc, plus the shared
  `POPOVER` and `LABEL` styles). `ColumnChooser` kept its own copy of the dismiss logic;
  fold it in only if phase 3 touches it anyway.
- **The filter bar wraps.** With half a dozen chips the row runs to a second line, so the
  bar's height is no longer fixed — phase 3's full-width table must size from the flex
  parent, not from a constant header height.
- **Help** — `filter-chip` is in, and the `filters` card now explains the floors/client-side
  split. Still owed: `detail-dock` (phase 3), `saved-screen` (phase 4).

### What phase 3 actually built (read before starting phase 4)

Where phase 3 differs from the sketch below, **this section wins**.

- **A third axis, and it is not `ScreenView`.** `lib/screen/columns.ts` now declares
  `ScreenTab` = `'fan' | 'near' | 'entries'` (the *row set*, i.e. the visible tab) beside
  `ScreenView` = `'fan' | 'entries'` (the *table shape*), with `tableViewOf(tab)` between
  them. `SavedScreen.view` in phase 4 is a `ScreenTab`; `columns` / `sort` stay keyed by
  `ScreenView`, so a saved screen persists **both** — the tab and the shape's column list.
- **`components/FanLists.tsx` → `components/ScreenView.tsx`**, one component and one
  `ScreenTable`. The component is `ScreenView` and the *type* `ScreenView` is imported there
  as `TableView`; that alias is the only place the two names collide.
- **The visible tab is derived, not trusted.** `view === 'entries'` with no strategy renders
  the fan tab. Phase 4 can therefore load a saved screen whose strategy no longer exists
  without a blank list — but it should still restore `signalStrategy` before `view`.
- **`store.ts` owns the coupling, not the slice.** `setSignalStrategy` moves the tab
  (to `entries` when a strategy is picked, back to `fan` when one is cleared while on it).
  It is the one place phase 4's "load a saved screen" must not fight: set the strategy first,
  then the view, or the strategy setter will overwrite the view you just restored.
- **`filteredMatches` / `filteredNear` are still unused.** Phase 2 flagged the duplication
  and phase 3 was the moment to pick — it kept the component's `useMemo`, because the tabs
  need the *unfiltered* totals for the "n of m shown" line and the filtered rows for the tab
  counts, and the slice getters give only the latter. Either delete them in phase 4 or give
  them the totals too; do not leave three ways to filter a list.
- **Search now counts as filtering** in the fan lists' count line (it always did in the
  entries list). One `narrowed` flag drives the "n of m shown" wording and the empty-list
  wording for all three tabs.
- **`lib/screen/dock.ts`** (new, not in the sketch) — `DOCK_MIN` 420, `DOCK_DEFAULT` 560,
  `DOCK_BREAKPOINT` 1100, a private list minimum of 520, `clampDockWidth(width, viewportW?)`
  and `isNarrow(viewportW)`. The clamp runs twice: on every drag frame and again at render,
  so phase 4 can restore a width saved on a 2500 px display onto a 1300 px one without
  checking anything itself. A non-numeric width falls back to the default.
- **The drag handle uses mouse events, not pointer events.** `preventDefault` on `pointerdown`
  does not stop the drag from selecting the table text behind it; `mousedown` does. Moves are
  coalesced to one `requestAnimationFrame` per frame because the canvas redraws on each width
  change, and `body.style.userSelect` is restored on mouseup.
- **Escape is shared.** The dock closes on Escape unless a help card is open — the dock's
  listener is registered before `HelpProvider`'s (child effects run first), so it cannot rely
  on `defaultPrevented` and checks for `[data-help-card]` in the DOM instead. Anything else
  that wants Escape has the same problem.
- **`FanDetail` was not touched.** Its canvas already sizes from `wrap.clientWidth` under a
  `ResizeObserver`, and 420 px is above its own 320 px floor.
- **Help** — `detail-dock` is in, on the drag handle. The tabs carry the `fan`, `fan-near`
  and `live-entry` ids that used to sit on the two panel titles. Still owed: `saved-screen`
  (phase 4).

### What phase 4 actually built

Where phase 4 differs from the sketch below, **this section wins**.

- **`lib/screen/storage.ts`** — as designed, with the shape in §7 unchanged. Two things the
  sketch did not pin down: **one storage object serves two key spaces** (`store.ts` hands the
  same injected storage to `loadStrategies` and to the slice; `memoryStorage` took an
  optional key so tests can seed either), and a stale screen is **repaired, not dropped** —
  bad clauses, unknown column ids and an unresolvable sort key go one by one, and only a
  missing id or name loses the whole screen.
- **`sanitizeColumns` keeps a list that is only the pinned column.** A list with nothing
  recognisable falls back to the view's defaults, but hiding every optional column is a real
  choice the chooser allows, so it round-trips. Adding the pinned ids back happens *after*
  that test, or the fallback could never fire.
- **`DEFAULT_SORT` moved from `store/screenSlice.ts` to `lib/screen/columns.ts`** (the slice
  re-exports it, so `store.ts` is unchanged). `sanitizeSort` needs it, and it is a per-view
  default like `DEFAULT_COLUMNS`. `columns.ts` also gained **`EXTRA_SORT_KEYS`** — the
  entries table's own sort keys, listed there so "does this key still resolve?" can be
  answered without importing a component. It is the one place that can drift from
  `SIGNAL_COLUMNS` in `ScreenView.tsx`.
- **`loadScreen`'s order is the whole trick**, and it is not what §7 implies. The filters go
  in first with a plain `set` — deliberately *not* through `setFilters`, whose floors
  callback would fire a scan on the strategy being replaced — then the strategy through
  `setSignalStrategy` (which moves the tab and starts exactly one scan, already carrying the
  saved floors), and the saved tab last. A strategy that no longer resolves loads as `''`.
- **`screenDirty` compares, and a draft is never dirty.** It diffs the live state against the
  saved copy field by field (clause order counts, key order does not — hence
  `screenStateEqual` rather than `JSON.stringify`). With no screen loaded it is false, so
  `Save` never appears for something that was never saved; `Save as…` is that path.
- **`ScreenMenu` replaced the filter bar's explanatory sentence**, as §4 asked. Its three
  variants (the chip hint, the entries note, the market-cap caveat) are all in help cards
  already, so nothing was lost but a line of prose.
- **Help** — `saved-screen` is in. Nothing is owed any more.

### Decisions to confirm (recommended answers in bold)

All of these are now **settled and shipped** — the last four in phase 2, the first two in
phase 3.

- ✅ **One full-width table with view tabs** (EMA fan / Close to fan / Entries) instead of the
  side-by-side split. Rationale: TradingView density, room for ~15 columns, one table
  component instead of two. The split cannot fit the new columns. *(Shipped. The density
  argument held for width and not for height — see phase 3's notes.)*
- ✅ **Docked detail panel** (right, resizable, ~560 px, non-modal) instead of the overlay
  drawer. The list stays visible and clickable; clicking another row swaps the symbol.
  *(Shipped, with the narrow-screen fallback below 1100 px.)*
- **Sorting and column choice are client-side** over the full row set the server already
  returns. No server changes for sorting.
- ✅ **Filter evaluation stays client-side** for fan rows. For `/signals` the server keeps its
  floors; the client derives them from the new filter clauses (min of `avgVol20`,
  `marketCap`, `ema200RisingBars`) and applies the rest after the scan. *(Shipped, and the
  derivation is `signalFloorsOf`; the re-scan trigger is a `floorsEqual` comparison, not a
  list of keys.)*
- **No `@tanstack/react-table`.** A ~80-line sort/column module is enough; remove the
  unused dependency in phase 1.
- ✅ **Saved screens in localStorage**, same pattern as strategies. No server persistence.
  *(Shipped. Phase 2 had already fixed what gets saved: clauses hold native units, and
  `ScreenFilters` is a plain `{ clauses }` object that survives `JSON.stringify` intact.)*
- ✅ **A range clause drops rows whose value is missing**, whichever bound is set. Raised by
  phase 1: `snapshot` fields are NaN when the history is too short, so "RSI 14 50–65" over a
  freshly listed name has nothing to compare. Dropping matches today's market-cap behaviour
  (already documented in the `market-cap` help card) and matches TradingView. The chip must
  say so — a count that shrinks for an invisible reason is the confusing case. Sorting keeps
  the opposite convention deliberately: missing sinks to the bottom but stays in the list.
- ✅ **Percent conversion is per `kind`, not per field.** `ratio` fields (`worstGap`, `perf1m`,
  `perf3m`, `atrPct`) hold fractions and a chip entered as `2.5` compares against `0.025`;
  `percent` fields (`changePct`) are *already* in percent units and `2.5` compares against
  `2.5`. Getting this backwards on `changePct` is the likeliest phase-2 bug. *(Shipped;
  `filters.test.ts` asserts both directions on both kinds.)*

## Design

### 1. Row enrichment — `src/lib/fan.ts` `toRow`, `src/lib/fanSignals.ts`

Add a shared `IndicatorSnapshot` (new file `src/lib/screen/snapshot.ts`) computed from the
closes and volumes the subject already holds:

```ts
interface IndicatorSnapshot {
  volume: number;        // last bar
  rsi14: number;         // NaN when history is short
  stochK: number;        // stochRsi(14,14,3,3) %K, 0–100
  stochD: number;
  perf1m: number;        // close / close[-21] − 1
  perf3m: number;        // close / close[-63] − 1
  atrPct: number;        // ATR(14) / close, the "volatility" proxy
  hi52: number; lo52: number;
}
```

`FanRow` and `FanSignalRow` both gain `snapshot: IndicatorSnapshot`. `atrPct` reuses
`atr14()` from `src/lib/strategy/primitives.ts` (move it to `indicators.ts` next to `rsi`
so `fan.ts` does not import from the strategy layer). Cost: one RSI/StochRSI pass per subject on the `/screen`
path, ~1500 names, well under the existing EMA cost.

**Built in phase 1** (with `stochD` added and the warm-up rules above). One caveat the
design missed: **JSON has no NaN**, so a snapshot that crosses `/screen` or `/signals`
arrives with those slots as `null`. Read them through `fields.ts`, which maps NaN and null
alike to "missing"; never test a snapshot field for NaN directly on the client.

### 2. Field registry — new `src/lib/screen/fields.ts`

One table drives filter chips, column headers, sorting and help ids:

```ts
interface FieldDef {
  id: FieldId;                   // 'price' | 'changePct' | 'volume' | 'relVol' | 'avgVol20' | 'marketCap'
                                 // | 'sector' | 'ema18' | 'ema50' | 'ema100' | 'ema200' | 'worstGap'
                                 // | 'rsi14' | 'stochK' | 'perf1m' | 'perf3m' | 'atrPct' | 'ema200Rising'
  label: string;                 // 'Rel vol'
  kind: 'number' | 'percent' | 'compact' | 'enum';
  get: (row: ScreenRowLike) => number | string | null;
  help: string;                  // glossary topic id
  align?: 'left' | 'right';
  defaultVisible: boolean;
  filterable: boolean;
  options?: () => string[];      // enum: sectors from store facts
}
```

`ScreenRowLike` is the intersection of `FanRow` and `FanSignalRow` (ticker, name, sector,
price, changePct, avgVol20, marketCap, snapshot) plus optional fan fields, so the signal
table can share every non-EMA column.

**Built in phase 1** — see "What phase 1 actually built" for the shipped `FieldDef`, which
splits `column` from `filterable` and carries more kinds than the sketch above. `relVol`
falls back to `snapshot.volume / avgVol20` for rows that do not carry it, so the entries
list gets the column for free.

### 3. Filter model — `src/lib/screen/filters.ts` (replaces `src/lib/filters.ts`)

```ts
type Clause =
  | { field: FieldId; kind: 'range'; min?: number; max?: number }   // numeric, either bound optional
  | { field: 'sector'; kind: 'in'; values: string[] }
  | { field: 'ema200Rising'; kind: 'bars'; bars: 21 | 63 | 105 };
interface ScreenFilters { clauses: Clause[] }
```

- `applyClauses(rows, filters)`; `clausesActive(filters)`; `signalFloorsOf(filters)` →
  `{ minAvgVol, minMarketCap, ema200RisingBars }` for the `/signals` body.
- `DEFAULT_FILTERS` = `[{ field: 'ema200Rising', kind: 'bars', bars: 21 }]` so today's
  default behaviour is unchanged.
- Migration: the five existing dropdowns become five clauses; `MIN_PRICE_PRESETS` etc.
  survive as **quick values** in the chip editor, not as the only choices.
- Units follow the field kind, and the split matters: **`ratio`** clauses are entered as
  `2.5` and compared as `0.025` (`worstGap`, `perf1m`, `perf3m`, `atrPct`); **`percent`**
  clauses are entered as `2.5` and compared as `2.5` (`changePct` is already in percent
  units). `compact` accepts `300M`, `1.2B` (`parseCompact`, inverse of `fmtCompact` — put it
  in `screen/format.ts` beside its inverse, not in the filter module).
- A range clause with either bound set **drops rows whose value is missing** (NaN in
  process, `null` after JSON). `clausesActive` must count such a clause as active so the
  "n of m shown" line explains the shrink.

**Built in phase 2** as designed — see "What phase 2 actually built" for the three things the
sketch did not pin down: clause order, the `ema200Ago`-less row, and what `clausesActive`
does *not* mean.

### 4. Filter bar UI — `src/components/FilterBar.tsx` rewrite, new `components/filters/`

TradingView layout: a row of chips, each `Label  op  value ×`, and a `+` chip that opens
a field picker. Clicking a chip opens a small popover with min / max inputs (or a
multi-select for sector, or the three lookbacks for the 200-EMA slope), quick-value
buttons, and Apply. Entry-strategy select stays first; the explanatory sentence on the
right becomes the screen name + Save (phase 4). `Clear filters` resets to
`DEFAULT_FILTERS`. Every chip keeps its `data-help` id so the hover cards still work.

**Built in phase 2**, with three notes for phase 4:

- The explanatory sentence on the right is **still a sentence** — turning it into the screen
  name + Save is phase 4's job, and that corner is where `ScreenMenu` goes.
- A chip added from the `+` opens its editor immediately (`autoOpen` / `onOpened` on
  `FilterChip`, `justAdded` in `FilterBar`), so adding and setting a filter is one gesture.
  Loading a saved screen must not trip that — it goes through `setFilters`, which does not
  touch `justAdded`.
- Quick values live in `QUICK_RANGES` (a `FieldId` → buttons map in `filters.ts`), keyed by
  field rather than hard-coded in the editor. A new filterable field simply has none.

### 5. Table — new `src/components/table/ScreenTable.tsx`, `src/lib/screen/sort.ts`

**Built in phase 1.** The bullets below are what shipped, with two corrections: sort state is
keyed by `SortKey` (string) rather than `FieldId`, and the ⚙ lives in the list section header
rather than the sticky column header.

- One component for fan rows and signal rows: `columns: FieldId[]`, `rows`, `sort`,
  `onSort`, `selected`, `onSelect`, `extra?: ColumnDef[]` for the signal-only columns
  (entry, stop, R, target window, age) and the sparkline.
- Sort state `{ field: FieldId; dir: 'asc' | 'desc' }` in the store; NaN/null always last;
  click header toggles, default sort stays worst-gap desc for fan, `barsAgo` asc for
  entries. `sortRows` is a pure function with tests.
- Row height 34 px, header sticky (`position: sticky; top: 0` inside the scroll div),
  tabular numbers, negative percents red, `compact` formatting for volume and cap.
- Column chooser: a ⚙ button in the table header opens a checklist of `FieldDef`s;
  visibility lives in the store as `columns: FieldId[]` per view.
- Grid template is computed from the visible columns (`fieldWidth(id)`), so `GRID` and
  `SIG_GRID` constants go away.
- Name column: when `name === ticker` (kaggle dataset) render `—` instead of repeating.

### 6. Layout — `src/AppScreener.tsx`, `src/components/FanLists.tsx` → `ScreenView.tsx`

- View tabs under the filter bar: **EMA fan (849) · Close to fan (36) · Entries** (Entries
  enabled when a strategy is selected). Header keeps the count sentence and the fan rule.
- `DetailOverlay` becomes `DetailDock`: a right-hand panel in the flex row, `width` in
  store (default 560, drag handle, min 420), no backdrop, Esc / × closes. `FanDetail`'s
  canvas already sizes itself from `wrap.clientWidth` under a `ResizeObserver`, so the
  chart reflows when the dock is dragged; the `PRICE_H` / pane heights stay.
- Mobile / narrow (< 1100 px): dock falls back to the current overlay behaviour.

**Built in phase 3** as designed. Three things the sketch did not pin down: the tab is a
`ScreenTab` and not the existing `ScreenView`; the drag needs mouse events rather than
pointer events to avoid selecting the table text; and the geometry (both minimums, the
breakpoint) lives in `lib/screen/dock.ts` so the store, the handle and the tests share it.
The ⚙ stayed in the list section header, as phase 1 asked.

### 7. Saved screens — new `src/lib/screen/storage.ts`, store slice, `components/filters/ScreenMenu.tsx`

```ts
interface SavedScreen {
  id: string; name: string; savedAt: string;
  filters: ScreenFilters; sort: SortState; columns: FieldId[];
  view: 'fan' | 'near' | 'entries'; signalStrategy: string;
}
```

Key `stockScreener.screens.v1`, same injected-storage + re-parse pattern as
`strategy/storage.ts`. UI mirrors TradingView's title: screen name with a ▾ menu (New,
Save, Save as…, Rename, Delete, and the saved list), `Save` shown only when the current
state differs from the saved copy (`dirty`). "Untitled screen" when none is loaded.
A `default` flag makes one screen load at startup.

### 8. Help — `src/help/glossary.ts`

New topics: `rel-vol`, `volume`, `rsi`, `stoch-rsi`, `perf`, `atr-pct`, `filter-chip`,
`saved-screen`, `column-chooser`, `detail-dock`. `place.test.ts` / `glossary.test.ts`
already assert that every `data-help` id resolves; extend the fixtures.

### 9. Store — keep `store.ts` from growing

New state (`filters: ScreenFilters`, `sort`, `columns`, `view`, `screens`, `activeScreenId`,
`dockWidth`) and actions go into `src/store/screenSlice.ts`, composed into `useScreener` the
same way the strategy list is today. `filteredMatches` / `filteredNear` move to the slice
and use `applyClauses` + `sortRows`.

Phase 1 put `sort` and `columns` (~30 lines) directly in `store.ts`, since the slice earns
its keep only once the clauses arrive. **Phase 2 created `screenSlice.ts` and moved those
two in with it** rather than leaving state split across both files.

**Built in phase 2.** `store.ts` went 583 → 490 lines and now spreads the slice at the top of
its state object; the slice's `set` / `get` are the store's own, typed against
`ScreenSlice & { matches, near }`, so adding phase-3/4 state is adding a field to
`ScreenSlice` and an initial value in `createScreenSlice`. `filteredMatches` / `filteredNear`
moved in but use `filterRows`, not `sortRows` — sorting is still the table's job.

## Phases

Each phase is one PR on a branch off `feat/strategy-builder` (or `main` once that merges),
green on `npm run typecheck && npm run test && npm run lint`.

| # | Phase | Delivers | Touch scope |
|---|---|---|---|
| 1 ✅ | **Columns and sorting** | `IndicatorSnapshot` on both row types; `fields.ts`; `ScreenTable` with sortable sticky header, 34 px rows, column chooser, volume / rel vol / avg vol / cap / sector / RSI / Stoch K columns; remove `@tanstack/react-table` | `lib/fan.ts`, `lib/fanSignals.ts`, `lib/indicators.ts`, `lib/screen/*`, `components/table/*`, `FanLists.tsx`, `store.ts` (sort/columns only), `help/glossary.ts` |
| 2 ✅ | **Filter model and chips** | `Clause` model, chip bar with ranges and free numeric input, indicator filters, `signalFloorsOf` feeding `/signals`, migration of the five presets | `lib/screen/filters.ts`, `lib/screen/format.ts` (`parseCompact`), `lib/screen/fields.ts` (`options` for sector), `components/filters/*`, `FilterBar.tsx`, `store/screenSlice.ts` (created here; `sort`/`columns` move in from `store.ts`), `fanSignals.ts` (`filterSignalRows` → clauses) |
| 3 ✅ | **Layout** | View tabs with a single full-width table; docked resizable detail panel; narrow-screen fallback | `AppScreener.tsx`, `ScreenView.tsx`, `detail/DetailPanels.tsx`, `FanDetail.tsx` (width only) |
| 4 ✅ | **Saved screens** | `SavedScreen` storage, screen menu, dirty/Save, default screen at startup | `lib/screen/storage.ts`, `lib/screen/columns.ts` (`sanitizeColumns`), `components/filters/ScreenMenu.tsx`, `store/screenSlice.ts`, `FilterBar.tsx` (not `TopBar.tsx` — the menu took the sentence's corner), `help/glossary.ts` |

Phase 1 is independent and immediately useful. Phases 2 and 3 can run in parallel after
phase 1. Phase 4 depends on 2 (it saves clauses).

## Tests

- ✅ `lib/screen/snapshot.test.ts`: RSI / Stoch / ATR% / perf on a ramp series; NaN when the
  history is shorter than the period; golden values against the detail-chart computation
  (same `indicators.ts` calls, so equal by construction).
- ✅ `lib/screen/fields.test.ts` (added in phase 1, not in the original list): every declared
  `help` id resolves to a glossary topic, each `kind` formats exactly once, missing values
  come back `null`, and the column defaults/toggle round-trip.
- ✅ `lib/screen/filters.test.ts`: every clause kind, open-ended ranges, percent and compact
  unit parsing (`300M`, `1.2B`, `2.5` → `0.025`), `signalFloorsOf`, default filters equal
  today's behaviour (ported from `filters.test.ts`, which is gone with `lib/filters.ts`).
- ✅ `lib/screen/sort.test.ts`: numeric / string / null ordering, direction toggle, stable for
  ties.
- ✅ `lib/screen/dock.test.ts` (added in phase 3, not in the original list): the dock width
  clamp against both minimums, a non-numeric width, and the overlay breakpoint boundary.
  `lib/screen/fields.test.ts` gained `tableViewOf`; `src/store.test.ts` gained the default
  tab, the entry-strategy select moving it, and the dock-width clamp.
- ✅ `lib/screen/storage.test.ts`: round-trip, corrupt JSON, unknown field id dropped, default
  flag unique, **a saved sort key that no longer resolves falls back to the view default**,
  and what `screenStateEqual` does and does not count as a change. `lib/screen/fields.test.ts`
  gained the two sanitizers; `src/store.test.ts` gained save / dirty / load / delete / rename,
  the default screen at start-up, and the saved floors on the first scan.
- ✅ `server/screen.test.ts` and `lib/fanSignals.test.ts`: rows carry `snapshot`. (There is
  no `server/signals.test.ts`; the signal scan is tested at the library level.)
- ✅ `src/store.test.ts`: `/signals` body carries floors derived from clauses, and a
  client-side clause (sector / price / RSI) does not re-run the scan. Sort and column state
  survive a `runScreen`.
- ✅ `help/glossary.test.ts`: every new `data-help` id resolves.

## Verification

- ✅ After phase 1 with `npm run dev`: sort the fan table by Rel vol, then by RSI (the arrow
  shows on **both** fan panels — they share the `fan` view's sort); hide the EMA columns from
  the ⚙ and Gap / RSI / Stoch come into view; header stays pinned while scrolling. Rows per
  screen went ~22 → ~30, not the "roughly doubles" estimated here: 34 px rows help, but the
  side-by-side split still caps it. The full doubling needs phase 3's full-width table.
- ✅ After phase 2 with `npm run dev`: the chips compose (Price 20–100 + RSI 14 40–50 took the
  synthetic fan list to "3 of 14 shown" then "2 of 14"), `400K` parses, the sector chip lists
  the dataset's own sectors, and changing the slope chip fires exactly one `/signals` request
  while adding a sector chip fires none. Still owed once a shared dataset is loaded: compare
  the count for Price 20–100 / Avg vol ≥ 400K / RSI 50–65 / Stoch K ≤ 20 against TradingView.
- ✅ After phase 3 with `npm run dev`: clicking a row docks the chart on the right, the table
  stays scrollable, a second click swaps the symbol in place, and dragging the divider
  redraws the chart at the new width. The Entries tab lights up when a strategy is selected
  and the tab follows the select both ways. Below 1100 px the overlay returns and Esc closes
  it. Rows per screen did **not** double (27 at 34 px in a 1216 px-tall window, the same as
  the split gave per panel) — the split's panels were side by side, so they were already
  full height. What the full-width table buys is the whole column set without the sideways
  scroll.
- ✅ After phase 4 with `npm run dev`: saved "Ema fan technical" (Last 20–100, sorted by RSI),
  edited the chip to 30–100 and `Save` lit up with a dot by the name; saved, marked it ★ and
  reloaded — chips, sort, columns and the Close-to-fan tab all came back. Repeated on the
  Entries tab with the 50-EMA tag strategy: it reloads with the strategy selected, the tab
  live and one scan, which is what the strategy-before-view order buys.

## Risks

- **`/screen` payload growth** (snapshot adds ~9 numbers per row, 1500 rows): negligible,
  but keep `snapshot` flat, no arrays. *(Measured in phase 1: fine.)*
- **NaN does not survive JSON.** Snapshot fields arrive client-side as `null`. Every clause
  and every sort must treat NaN and null identically — go through `fields.ts`, never test a
  snapshot field directly.
- **Warm-up values that look like real readings.** The reason phase 1 guards Stoch RSI at
  2 x the period: before that, %K is a genuine-looking `0` computed from backfilled RSI. Any
  new indicator field needs the same question asked of it, or a chip will silently match
  names on a warm-up artefact.
- **Filter migration breaks the help ids**: keep the old `data-help` ids on the new chips
  (`min-price`, `avg-volume`, …) and add new ones only for new fields. *(Handled in phase 2:
  a chip reads `FieldDef.help`, so the ids came across without a lookup table;
  `glossary.test.ts` still asserts every id resolves.)*
- **Docked panel and the canvas chart**: the drag handle changes the dock width on every
  mouse move; the existing `ResizeObserver` redraws the canvas each time. Throttle with
  `requestAnimationFrame` if the drag stutters. *(Phase 3 throttles unconditionally — one
  width per frame — rather than waiting to see whether it stutters.)*
- **Store growth**: enforced by putting all new state in `store/screenSlice.ts`; `store.ts`
  should only get the slice import. *(Phase 2: 583 → 490 lines. Phase 3 added `view` and
  `dockWidth` to the slice and no state to `store.ts` — only the one line in
  `setSignalStrategy` that moves the tab. Phase 4's `screens` / `activeScreenId` must not
  reopen it. Phase 4 did not: `screens` / `activeScreenId` went into the slice, and `store.ts`
  took one extra argument to `createScreenSlice` and one line in `init`. It is 523 lines —
  the growth since phase 2's 490 is phase 3's, not new state.)*
- **Percent-unit confusion** in clauses: the chip shows `%` and the `FieldDef.kind` owns
  the conversion in one place; tests cover both directions. *(Closed in phase 2.)*

- **A new filterable field is a new way to drop rows silently.** Marking `filterable: true`
  on a field in the registry is now enough to put it in the `+` picker, with no other code —
  which also means a field whose value is often missing will quietly shrink the lists the
  first time someone filters on it. Ask the warm-up question (above) of any field before
  turning the flag on.

## Out of scope (deliberately)

Fundamentals (P/E, EPS, dividends, analyst rating, earnings dates), dark theme, watchlists,
server-side persistence of screens, and URL-encoded screens. The data-quality issue that the
kaggle dataset has no company names or sectors is an import concern, not a screener one.
(Phase 1 does render `—` instead of repeating the ticker when `name === ticker`.)

## Known inconsistency, noticed in phase 1

`Stock.hi52` / `lo52` / `pct52w` in `src/lib/market.ts` are computed over the **whole close
history**, not 52 weeks, despite the name — `Math.max(...closes)`. Nothing reads them today
(they are set on the model and never displayed), so nothing is wrong on screen, and phase 1
left them alone. The screener's own `snapshot.hi52` / `lo52` are a true 252-bar window over
highs and lows. Any later work that wants "% from the 52-week high" must take it from the
snapshot, or fix `market.ts` first — do not reach for `Stock.hi52`.
