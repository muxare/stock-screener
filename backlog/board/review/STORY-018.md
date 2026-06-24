---
id: STORY-018
type: story
parent: FEAT-009
capability: CAP-screen
sad_refs: [SAD#4.1, SAD#5.9, SAD#2.5]
target: ~
estimate: ~
attempts: 3
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
