# stock-screener — agent guide

Read by Claude Code as `CLAUDE.md` and by other agents as `AGENTS.md`. The two files are
**byte-identical**: change one and copy it over the other (`cp CLAUDE.md AGENTS.md`), and
from phase B of `docs/cca-f-learning-plan.md` CI fails the build when they differ.

This is the *project* level of the guidance hierarchy. Personal conventions — the language
of commit messages, how terse a reply should be, how much to do before asking — belong in
`~/.claude/CLAUDE.md` and must not be added here; guidance that is only relevant while a
particular part of the tree is being edited belongs in `.claude/rules/`, which loads with
the files it governs.

A stock screener: compose, save, and run technical screens against a market universe.
React/TypeScript front end, a Node/TypeScript server, and a TypeScript + Python tooling
layer for market-data import. `README.md` is the human-facing description of what it does
and why.

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
npm run typecheck    # tsc -b, plus the server and tools projects
npm run build        # npm run typecheck && vite build
npm run lint         # eslint .
npm run test         # vitest run   (use test:watch while developing)
# data import
npm run eod:import        # tools/eod-import
npm run yahoo:fetch       # tools/yahoo-fetch (also :backfill, :daily)
```
Typecheck, lint and tests are the definition of done, and all three run in CI on every
push and PR. Run `/verify` rather than the three commands by hand — it runs every gate
even when an earlier one fails, and reports one screen.

## Layout
- `src/` — React app. `src/store.ts` is the central Zustand store; `src/lib/` holds
  the indicator math (`indicators.ts`), the Stock model (`market.ts`), the fan
  screener/backtest/signals (`fan*.ts`), the strategy engine (`strategy/`) and the data
  client (`client/marketClient.ts`); `src/components/` the UI.
- `server/` — API + dev dataset handlers, screening/backtest logic.
- `tools/` — data-import scripts (eod-import, yahoo-fetch).
- `docs/` — `development-diary.md` (the running record of what changed and why) and
  per-feature implementation plans (`platform-hardening-plan.md` is the roadmap;
  `cca-f-learning-plan.md`, `borsdata-ingest-plan.md`, `strategy-builder-plan.md`,
  `screener-parity-plan.md`).

## Conventions
- TypeScript throughout; keep changes within the plan's declared **Touch scope**.
- Prefer editing existing modules over adding new ones; watch the size/coupling of
  `src/store.ts` and `src/lib/fanBacktest.ts`.
- Async/error-state discipline is the known rework class — handle loading/error
  paths explicitly.
- A backtest number is not self-evidently meaningful: costs are not modelled and a
  per-trade *t* overstates significance. Phase 6.2 of `docs/platform-hardening-plan.md`
  has the measurements and the rules; the `backtest-reviewer` agent applies them.

## What `.claude/` provides
- **`rules/`** — path-scoped guidance that loads only when matching files are edited:
  `engine.md` (`src/lib/**`), `server.md` (`server/**`), `docs.md` (`docs/**`). A rule
  points at a document to read on a condition rather than importing it.
- **`skills/`** — `/verify` (run the gates), `/touch-scope` (what this branch changes
  outside its plan's scope), `/diary-entry` (write the entry for a landed phase),
  `/phase-plan` (scaffold a new plan).
- **`agents/`** — `backtest-reviewer`, `plan-auditor`, `diary-writer`. All three are
  read-only by construction: a hook in their frontmatter refuses anything but a reading
  shell, so they return findings and leave the edit to the session that asked.
- **`hooks/`** — `eslint --fix` on each edited `.ts`/`.tsx` file, a refusal on writes to
  `*.db` / `.env*` / `dist/` with a warning outside the branch's touch scope, and the
  suite on Stop when `src/` or `server/` changed. All advisory except the write refusal;
  CI stays the hard gate.

## How work is governed (short version)
There is no sprint board any more (removed 2026-09-04, commit a45325d). Work is driven
from **`docs/development-diary.md`** and plain git history:
- Non-trivial features start as a plan in `docs/<feature>-plan.md` with phases, touch
  scope, tests and verification steps. Work one phase per branch/PR.
- When a phase or feature lands, add a dated entry to the diary (what changed, where it
  lives, how to test) and mark the plan's status line. Where the phase's text turned out
  to be wrong, correct it in the plan where the claim was made.
- Run `git log --oneline` and read the latest diary entry to find out where things stand.
