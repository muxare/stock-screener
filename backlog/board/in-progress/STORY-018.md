---
id: STORY-018
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#4.1, SAD#5.9, SAD#2.5]
target: ~
estimate: ~
attempts: 4
blocked_reason: ~
---

## User Story
As a trader, I want the client to use the screening service so that the browser stops computing the full universe.

## Acceptance Criteria
- [x] The client calls the screening/backtest service for full-universe runs.
- [x] In-browser full-universe compute (`M.generateUniverse` + full-universe `evalGroupedRules`/`backtestRules` in the store) is retired.
- [x] The client still computes locally for detail/compare and small ad-hoc sets (single-name eval ≤ 50ms).
- [x] The store reads results from the service via SAD#5.9 selectors.

## Architectural Constraints (from SAD)
- Per SAD#2.5 the browser must not compute the full universe; keep only displayed-name compute client-side.
- Do NOT add a second state store; route results through SAD#5.9.

## Out of scope
- Service implementation (STORY-016/017).

## Status
DONE (pending review). The store (`src/store.ts`) is now the SAD#5.9 client
source of truth backed entirely by the service:

- `runScreen()` POSTs `/screen` for the active rule set; `screenList`/
  `filteredStocks` read the returned `ScreenRow[]`. A module-level
  `useScreener.subscribe` re-screens whenever the effective rule set changes.
- `openBacktest()` streams `/backtest` (NDJSON progress → summary), off the UI
  thread (SAD#2.4); the modal shows a progress bar.
- Detail/compare fetch `/instrument/:ticker` on demand and build the Stock
  locally via `buildStock` (≤50 ms, SAD#2.3) — the only client-side compute.
- The in-browser full-universe build (`buildUniverse(syntheticProvider…)`) and
  every `evalGroupedRules`/`backtestRules`/`rankPassSet` over `st.universe` are
  gone (SAD#2.5). The synthetic generator no longer reaches client code.

### Decisions (confirmed with product owner)
- **Preview/count surfaces routed through `/screen` too** (preset cards, saved-
  screen alert counts, builder match previews, sector facets, "of N" total).
  None of these compute over a local universe anymore — they read service
  counts (`presetCounts`/`screenCounts`, debounced `previewCount`). Fully honors
  SAD#2.5.
- **Refresh-data removed.** The Top-bar "Refresh" simulated a new session by
  reseeding the synthetic universe **client-side** (`seed+1`) — impossible once
  data lives on the seed-pinned service. The button, `refreshData`, and the
  session-diff banner + screen alerts it drove were removed. *Follow-up:* a
  server-side reseed/new-session capability if that affordance is still wanted.

### Necessary deviations from Touch scope (flagged)
- `server/screen.ts` `ScreenRow`/`toRow` extended with `macdHist`, `stochK`,
  `ema20/50/200`, and the 40-day `sparkline` — the results table (SAD#5.2)
  renders these columns and STORY-016's projection omitted them, so AC1/AC4 were
  otherwise impossible. `server/screen.test.ts` updated to lock the contract.
- `vite.config.ts` dev proxy for `/screen`, `/backtest`, `/instrument` →
  `:8787` so the browser reaches the service same-origin.
- Added `tests/store.client.test.ts` — client↔service integration coverage
  (the client had none).

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- src/store.ts
- src/components/**

## Review findings (high-effort code review, 2026-06-24) — REQUIRED FIXES
Bounced review → in-progress. Workflow review (8 finder angles, 35 candidates,
independent verify pass) confirmed 10 regressions. Root cause across all of
them: data access moved to async/streamed service calls without error-state or
request-sequencing discipline, so failures and races surface to the user as
confident wrong answers rather than errors. Fix before re-submitting to review.
Guiding principle: define ONE explicit error/loading state per service path and
stop coercing failures to `0`/`null`/empty.

### Blockers (wrong answers presented as authoritative) — ✅ FIXED 2026-06-24
Resolved on this branch; regression tests added in `tests/store.client.test.ts`
("service failures are not misreported as zero results"). `npm test` 39 passing,
`tsc -b` + lint clean. Detail below per item.
1. ✅ **Backtest failure misreported as "screen never fired"** — `src/components/modals/BacktestModal.tsx:84`, `src/store.ts:1046`.
   Added a `backtestError` state; `openBacktest` now treats a rejected stream OR
   a result-less stream (null) as an error, and the modal renders a distinct
   error block. "Never fired" now requires a real zero-signal result.
   `openBacktest` `.catch(() => set({ backtestRunning: false }))` leaves
   `backtestResult` null; the modal renders null as `btEmpty` → "This screen
   never fired… Loosen a rule and try again." A service outage / aborted stream
   / result-less NDJSON tells the user a correct screen is worthless. Add a
   distinct backtest error state; do not render failure as a zero-match result.
2. ✅ **`previewCount` returns 0 on service error** — `src/components/modals/ScreenBuilderModal.tsx:78`, `src/store.ts:1078`.
   `previewCount` now returns `number | null` (null = unknown); both builder
   modals render "—" instead of 0 when the count is unknown.
3. ✅ **Count refreshers swallow errors → 0** — `src/store.ts:1064`
   (`refreshPresetCounts`/`refreshScreenCounts`/`refreshRankPass`, empty catch).
   The catches still preserve last-known-good, but the readers no longer coerce
   an absent count to 0: Presets/Screens badges show "—" for unknown, and the
   detail rank criterion is tri-state (`_pass: undefined` → neutral pending
   marker, not a ✕).

### Races & stale state
4. **`runScreen()` has no request-sequencing guard** — `src/store.ts:1037`/`1059`.
   Out-of-order `/screen` responses show the wrong list for the active rule set.
   Add last-write-wins (request id / abort prior).
5. **`openBacktest()` is re-entrant** — `src/store.ts:1044`. `closeBacktest`
   only clears `backtestOpen`; a stale stream's `.then` can overwrite the newer
   result. Cancel/guard in-flight stream on close/re-run.
6. **Stale `selected`/`compareSel` after rule change** — `src/store.ts:1058`.
   Reactive `runScreen` no longer resets selection (old `refreshData` did), so
   detail/compare show a name absent from the current result set. Clear or
   reconcile selection when rows change.

### Silent failures & dead-on-boot
7. **Detail overlay silently does nothing on fetch failure** — `src/components/detail/DetailPanels.tsx:69`/`38`.
   `ensureDisplayed` swallows 404/network errors; overlay returns null → row
   looks unclickable (no chart/error/spinner). Add error/loading affordance.
8. **Compare drawer opens with <2 (or 0) columns** — `src/components/compare/Compare.tsx:140`.
   Columns map `compareSel` through async `displayed[t]`; opening before fetches
   land (or on 404) yields a 1-column/empty comparison. Gate on loaded bars.
9. **No re-run after the service becomes reachable** — `src/store.ts:1065`.
   Service down at load → permanently empty app ("of 0", no sectors) until a
   rule edit/reload; the only manual re-trigger (Refresh) was removed. Add a
   retry/reconnect path and communicate offline state.
10. **Indicator-builder preview permanently dead if boot fetch fails** — `src/components/modals/IndicatorBuilderModal.tsx:65`.
    `sampleStock` fetched once in `bootstrap()` with no retry; preview shows "—"
    for the whole session even after the service recovers. Add retry/lazy fetch.

### Cleanup (CONFIRMED, lower priority — fold in if cheap)
- `bootstrap()` fetches the full universe with 40-element sparklines per row
  just to derive the sector list + count — `src/store.ts:539`. Request a
  count/sector-only projection instead of `ALL_ROWS` full payload.

### Refuted (no action — pure style / no observable effect)
`Row` duplicates server `ScreenRow`; debounce effect duplicated across
Preset/Screen builders; three near-identical count refreshers; `filteredStocks`
re-inlines `screenList()`; rank-cache key derivation split across
producer/consumer (keys provably match today). Optional DRY only.
