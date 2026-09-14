# AGENTS.md — stock-screener

A stock screener: compose, save, and run technical screens against a market
universe. React/TypeScript front end, a Node/TypeScript server, and a
TypeScript + Python tooling layer for market-data import.

## Stack
- **Front end:** React 19 + TypeScript, Vite 8, Zustand (state), React Router.
- **Server:** Node + TypeScript (`server/`), SQLite dev database (`dev-market.db`).
- **Tooling:** TS + Python (`tools/`) for EOD / Yahoo data import.
- **Tests:** Vitest. **Lint:** ESLint (flat config).

## Commands
```bash
npm run dev          # server + client together (client via Vite, server with DEV_TOOLS=1)
npm run dev:client   # Vite dev server only
npm run dev:server   # Node server only (watch)
npm run build        # tsc -b && vite build
npm run lint         # eslint .
npm run test         # vitest run   (use test:watch while developing)
# data import
npm run eod:import        # tools/eod-import
npm run yahoo:fetch       # tools/yahoo-fetch (also :backfill, :daily)
```
Run `npm run test` and `npm run lint` before considering any change done.

## Layout
- `src/` — React app. `src/store.ts` is the central Zustand store; `src/lib/` holds
  the indicator math (`indicators.ts`), the Stock model (`market.ts`), the fan
  screener/backtest/signals (`fan*.ts`) and data client (`client/marketClient.ts`);
  `src/components/` the UI.
- `server/` — API + dev dataset handlers, screening/backtest logic.
- `tools/` — data-import scripts (eod-import, yahoo-fetch).
- `docs/` — `development-diary.md` (the running record of what changed and why) and
  per-feature implementation plans (`strategy-builder-plan.md`, `screener-parity-plan.md`).

## Conventions
- TypeScript throughout; keep changes within the plan's declared **Touch scope**.
- Prefer editing existing modules over adding new ones; watch the size/coupling of
  `src/store.ts` and `src/lib/fanBacktest.ts`.
- Async/error-state discipline is the known rework class — handle loading/error
  paths explicitly.

## How work is governed (short version)
There is no sprint board any more (removed 2026-09-04, commit a45325d). Work is driven
from **`docs/development-diary.md`** and plain git history:
- Non-trivial features start as a plan in `docs/<feature>-plan.md` with phases, touch
  scope, tests and verification steps. Work one phase per branch/PR.
- When a phase or feature lands, add a dated entry to the diary (what changed, where it
  lives, how to test) and mark the plan's status line.
- Run `git log --oneline` and read the latest diary entry to find out where things stand.
