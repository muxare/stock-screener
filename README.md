# stock-screener

A technical stock screener you compose in the browser and run against a whole market
universe: build a rule set out of price, volume and indicator conditions, see which names
match today, open one and read its chart, then ask the same rules what they would have
done over every bar of history the dataset holds.

The screening engine (`src/lib/`) is one body of code that runs in two places — in the
browser for the handful of names on screen, and in the Node service for a full-universe
screen or backtest, so a result never depends on which side computed it.

## What it does

- **Screen.** Filter bar plus a sortable table of the matching universe, with an indicator
  snapshot per row (`src/components/`, `server/screen.ts`). Presets are built in; a screen
  you compose can be saved locally.
- **Detail.** One instrument's chart with the fan of moving averages, its indicators and
  the signals the current rules fire on it (`src/components/detail/`, `src/lib/chart/`).
- **Backtest.** Run the current rules over the full universe and full available history,
  server-side, streamed as NDJSON so a long run stays observable, and summarised per
  holding horizon (`src/lib/fanBacktest.ts`, `server/fanBacktest.ts`).
- **Strategy builder.** Compose a multi-step entry/exit strategy in the UI and backtest it
  with the same engine (`src/components/modals/StrategyBuilder.tsx`, `src/lib/strategy/`).

**Backtest numbers are not self-evidently meaningful**, and this repo is explicit about
why: transaction costs are not modelled yet, and the effective sample size comes from
elapsed time rather than universe breadth, so a per-trade *t* overstates significance.
Phase 6.2 of `docs/platform-hardening-plan.md` holds the measurements and the rules that
follow from them; read it before believing or quoting a number.

## The three intents

The project is deliberately three things at once, which is what makes the roadmap in
`docs/platform-hardening-plan.md` shaped the way it is:

1. **A research platform** — try strategies out. Runs must become durable, reproducible
   and statistically honest.
2. **A trading platform** — produce entries *to consider* at Avanza, from a scheduled
   post-close pipeline writing an immutable signal log. The design invariant is that the
   system never places an order and never holds a credential that could.
3. **A learning platform** — the infrastructure and the Anthropic *Claude Certified
   Architect* material get applied to real features here, not to toy ones
   (`docs/cca-f-learning-plan.md`).

## Running it

Node ≥ 24.2; the TypeScript sources run directly, so there is no build step for the
server.

```bash
npm install
npm run dev          # Vite client on :5173 + the service on :8787 (DEV_TOOLS=1)
```

`npm run dev:client` and `npm run dev:server` start the halves separately. Vite proxies
`/screen`, `/signals`, `/backtest`, `/instrument`, `/facts`, `/metrics` and `/dev` to the
service; point them elsewhere with `VITE_SCREEN_API`.

With no dataset configured the service boots against a synthetic generator — real-shaped
data that is demo data, and labelled as such in the UI. To serve imported bars instead,
set `MARKETDATA_DB` to a SQLite file, or select one through the dev import modal, which
is what `DEV_TOOLS=1` exposes.

## Data

```bash
npm run eod:import -- --config tools/eod-import/config.example.json --out dev-market.db data/
npm run yahoo:fetch        # per-ticker fetch; also :backfill and :daily
```

`tools/eod-import` is the only writer of the market database; everything else reads it
through the `MarketDataProvider` port in `server/universe.ts`. The `.db` files are
generated and gitignored — never edit one by hand. Nordic coverage through Börsdata is
planned in `docs/borsdata-ingest-plan.md`.

## Layout

- `src/` — the React app. `src/store.ts` is the central Zustand store; `src/lib/` is the
  engine (indicator math, the `Stock` model, the fan screener/backtest/signals, the
  strategy engine) and must stay free of Node imports and I/O, because the browser runs
  it too.
- `server/` — the Node service: the HTTP surface in `index.ts`, transport-agnostic
  handlers in `handlers.ts`, and the dev-only `/dev/*` routes behind `DEV_TOOLS`.
- `tools/` — data import (`eod-import`, `yahoo-fetch`).
- `docs/` — the plans and the development diary.

## Gates

```bash
npm run typecheck
npm run lint
npm run test
```

All three run on every push and pull request (`.github/workflows/ci.yml`) and are the
definition of done for a change. Inside Claude Code, `/verify` runs the three and reports
one screen of pass/fail.

## How the work is organised

There is no board. A non-trivial feature starts as a plan in `docs/<feature>-plan.md` — a
dated status line, a phases table, and per phase a **Touch scope** and a **Verify** line —
and is worked one phase per branch and pull request. When a phase lands it gets a dated
entry in `docs/development-diary.md` saying what changed, where it lives and how to test
it, and the plan's status line is updated. `git log --oneline` plus the newest diary entry
is how you find out where things stand.

`CLAUDE.md` (and `AGENTS.md`, its byte-identical copy) is the entry point for an agent
working here. `.claude/` carries the rest: path-scoped rules that load with the files they
govern, the `/verify`, `/touch-scope`, `/diary-entry` and `/phase-plan` commands, three
read-only review subagents, and the hooks that lint an edited file and run the suite.
