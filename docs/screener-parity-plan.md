# Screener parity — implementation plan

Status (2026-09-08): **phase 1 landed** (columns and sorting); phases 2–4 proposed. Closes the gap between Screenr and a TradingView-style
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
- `src/lib/indicators.ts` exports `ema`, `sma`, `rsi`, `stochRsi`, `macd`.
- Tables: `FanTable` / `SignalTable` in `src/components/FanLists.tsx`, CSS-grid rows with a
  hard-coded `GRID` template. `@tanstack/react-table` is in `package.json` but unused.
- Persistence pattern: `src/lib/strategy/storage.ts` (injected storage, re-parse on load,
  drop bad entries) with `store.ts` owning the list.
- `src/store.ts` is 553 lines; new state must go in its own modules.

### Decisions to confirm before phase 2 (recommended answers in bold)

- **One full-width table with view tabs** (EMA fan / Close to fan / Entries) instead of the
  side-by-side split. Rationale: TradingView density, room for ~15 columns, one table
  component instead of two. The split cannot fit the new columns.
- **Docked detail panel** (right, resizable, ~560 px, non-modal) instead of the overlay
  drawer. The list stays visible and clickable; clicking another row swaps the symbol.
- **Sorting and column choice are client-side** over the full row set the server already
  returns. No server changes for sorting.
- **Filter evaluation stays client-side** for fan rows. For `/signals` the server keeps its
  floors; the client derives them from the new filter clauses (min of `avgVol20`,
  `marketCap`, `ema200RisingBars`) and applies the rest after the scan.
- **No `@tanstack/react-table`.** A ~80-line sort/column module is enough; remove the
  unused dependency in phase 1.
- **Saved screens in localStorage**, same pattern as strategies. No server persistence.

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
- Units follow the field kind: `percent` clauses are entered as `2.5` and compared as
  `0.025`; `compact` accepts `300M`, `1.2B` (`parseCompact`, inverse of `fmtCompact`).

### 4. Filter bar UI — `src/components/FilterBar.tsx` rewrite, new `components/filters/`

TradingView layout: a row of chips, each `Label  op  value ×`, and a `+` chip that opens
a field picker. Clicking a chip opens a small popover with min / max inputs (or a
multi-select for sector, or the three lookbacks for the 200-EMA slope), quick-value
buttons, and Apply. Entry-strategy select stays first; the explanatory sentence on the
right becomes the screen name + Save (phase 4). `Clear filters` resets to
`DEFAULT_FILTERS`. Every chip keeps its `data-help` id so the hover cards still work.

### 5. Table — new `src/components/table/ScreenTable.tsx`, `src/lib/screen/sort.ts`

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

## Phases

Each phase is one PR on a branch off `feat/strategy-builder` (or `main` once that merges),
green on `npm run typecheck && npm run test && npm run lint`.

| # | Phase | Delivers | Touch scope |
|---|---|---|---|
| 1 ✅ | **Columns and sorting** | `IndicatorSnapshot` on both row types; `fields.ts`; `ScreenTable` with sortable sticky header, 34 px rows, column chooser, volume / rel vol / avg vol / cap / sector / RSI / Stoch K columns; remove `@tanstack/react-table` | `lib/fan.ts`, `lib/fanSignals.ts`, `lib/indicators.ts`, `lib/screen/*`, `components/table/*`, `FanLists.tsx`, `store.ts` (sort/columns only), `help/glossary.ts` |
| 2 | **Filter model and chips** | `Clause` model, chip bar with ranges and free numeric input, indicator filters, `signalFloorsOf` feeding `/signals`, migration of the five presets | `lib/screen/filters.ts`, `components/filters/*`, `FilterBar.tsx`, `store/screenSlice.ts`, `fanSignals.ts` (`filterSignalRows` → clauses) |
| 3 | **Layout** | View tabs with a single full-width table; docked resizable detail panel; narrow-screen fallback | `AppScreener.tsx`, `ScreenView.tsx`, `detail/DetailPanels.tsx`, `FanDetail.tsx` (width only) |
| 4 | **Saved screens** | `SavedScreen` storage, screen menu, dirty/Save, default screen at startup | `lib/screen/storage.ts`, `components/filters/ScreenMenu.tsx`, `store/screenSlice.ts`, `TopBar.tsx` |

Phase 1 is independent and immediately useful. Phases 2 and 3 can run in parallel after
phase 1. Phase 4 depends on 2 (it saves clauses).

## Tests

- `lib/screen/snapshot.test.ts`: RSI / Stoch / ATR% / perf on a ramp series; NaN when the
  history is shorter than the period; golden values against the detail-chart computation
  (same `indicators.ts` calls, so equal by construction).
- `lib/screen/filters.test.ts`: every clause kind, open-ended ranges, percent and compact
  unit parsing (`300M`, `1.2B`, `2.5` → `0.025`), `signalFloorsOf`, default filters equal
  today's behaviour (port `filters.test.ts`).
- `lib/screen/sort.test.ts`: numeric / string / null ordering, direction toggle, stable for
  ties.
- `lib/screen/storage.test.ts`: round-trip, corrupt JSON, unknown field id dropped, default
  flag unique.
- `server/screen.test.ts`, `server/signals.test.ts`: rows carry `snapshot`.
- `src/store.test.ts`: `/signals` body carries floors derived from clauses; sort and column
  state survive a `runScreen`.
- `help/glossary.test.ts`: every new `data-help` id resolves.

## Verification

- After phase 1 with `npm run dev`: sort the fan table by Rel vol, then by RSI; hide the
  EMA columns from the chooser; header stays pinned while scrolling; row count per screen
  roughly doubles.
- After phase 2: reproduce the TradingView screen as chips — Price 20–100, Avg vol ≥ 400K,
  RSI 14 50–65, Stoch K ≤ 20 — and compare the count with the same filters on TradingView
  for a shared dataset; `curl` the `/signals` body and confirm `minAvgVol: 400000`.
- After phase 3: click a row, chart docks on the right, the table remains scrollable and a
  second click swaps the symbol; drag the divider; resize the window under 1100 px and the
  overlay returns.
- After phase 4: save the screen as "Ema fan technical", reload, it is listed and loads with
  the same chips, sort and columns; mark it default; edit a chip and `Save` lights up.

## Risks

- **`/screen` payload growth** (snapshot adds ~9 numbers per row, 1500 rows): negligible,
  but keep `snapshot` flat, no arrays.
- **Filter migration breaks the help ids**: keep the old `data-help` ids on the new chips
  (`min-price`, `avg-volume`, …) and add new ones only for new fields.
- **Docked panel and the canvas chart**: the drag handle changes the dock width on every
  mouse move; the existing `ResizeObserver` redraws the canvas each time. Throttle with
  `requestAnimationFrame` if the drag stutters.
- **Store growth**: enforced by putting all new state in `store/screenSlice.ts`; `store.ts`
  should only get the slice import.
- **Percent-unit confusion** in clauses: the chip shows `%` and the `FieldDef.kind` owns
  the conversion in one place; tests cover both directions.

## Out of scope (deliberately)

Fundamentals (P/E, EPS, dividends, analyst rating, earnings dates), dark theme, watchlists,
server-side persistence of screens, and URL-encoded screens. The data-quality issue that the
kaggle dataset has no company names or sectors is an import concern, not a screener one.
