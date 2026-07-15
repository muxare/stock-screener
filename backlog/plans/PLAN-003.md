---
id: PLAN-003
type: plan
parent: IDEA-002
source_kind: idea
---

# Project Plan — End-of-day market-data fetch (Yahoo Finance EOD)

> **⏸ DEFERRED to post-MVP (decided 2026-07-09).** Yahoo is no longer a committed
> MVP data vendor — see SAD#8.8 ADR-008. The fetcher shipped by this plan
> (tools/yahoo-fetch, STORY-050–053) stays in the tree and working behind the
> `MarketDataProvider` port, but is **not** on the MVP critical path and is **not**
> the dev boot default. MVP now runs on a **local, static EOD snapshot** (Boris
> Marjanovic "Huge Stock Market Dataset", Stooq-sourced adjusted closes) loaded
> through the existing STORY-031 CSV importer. Rationale: the unofficial Yahoo
> endpoint is rate-limited (hard HTTP 429 from a dev IP, 2026-07-08) and its ToS
> bars redistribution — not worth carrying on the MVP path when a local snapshot
> suffices. Re-committing Yahoo (or any live vendor) is a fresh decision after MVP;
> everything below remains valid design for that future work.

Derived from `backlog/ideas/IDEA-002.md`. Resolves the open vendor question
(SAD#8.8 ADR-008) for a **personal / dev-use** deployment by selecting **Yahoo
Finance EOD** as the data source and building the one thing the existing data
layer still lacks: a **network fetcher** that pulls daily OHLCV from Yahoo and
lands it in the SAD#6.1 SQLite schema, where the existing `sqliteProvider`
(STORY-032, SAD#5.10) serves it through the `MarketDataProvider` port with **no
engine, handler, or port change**.

Scope is the **fetch front-end + EOD-append run + the ADR-008/SAD amendment**.
Everything downstream of "bars on disk" already exists and is reused, not rebuilt.

## Problem
The screener has no real market data. Production data today is either the
synthetic generator (a demo fixture, ADR-007 / SAD#1.2) or a SQLite DB hand-fed
from CSV files already on disk (STORY-031 importer + STORY-032 reader). ADR-008
(vendor selection) is still **proposed**, so nothing actually *fetches* real
bars — a human has to source CSVs out-of-band.

The data layer is otherwise complete for this purpose:
- `tools/eod-import` parses CSV → trusts bars as pre-adjusted (SAD#2.2 /
  ADR-005) → **idempotently upserts** on `(ticker, date)` / `ticker` → writes the
  `instrument`/`bar` schema (SAD#6.1).
- It already ships `config.yahoo.json` mapping the *shape* of a Yahoo/yfinance
  export (one file, `Company` column, ISO timestamped dates, ignored
  `Dividends`/`Stock Splits` columns).
- `sqliteProvider` (STORY-032) serves any such DB read-only behind the port.

The single missing link is the **network fetch**: actually pulling Yahoo EOD
(historical backfill + a daily post-close update) and producing input for that
pipeline. This plan adds exactly that link and makes Yahoo the named source.

## Target users
- **The operator (Mikael) running the screener for personal/dev use** — the
  primary and, per the deployment decision, the *only* consumer. Wants to point
  the screener at a real universe of real EOD bars and re-run it daily after the
  close, replacing the synthetic demo data.
- **The system itself** — the screening service (SAD#4.2) and client (SAD#4.1)
  consume the resulting DB unchanged via the existing port; they are downstream
  beneficiaries, not a new audience.

This is explicitly **not** an external/product audience (see Non-goals): no bars
are redistributed to third parties.

## Success metrics
(measurable)
- **Backfill populates a servable DB:** a historical fetch over a supplied
  ticker list writes a SQLite DB that `sqliteProvider` opens and serves with
  **zero changes** to `provider.ts` / `sqlite.ts` / the engine — verified by the
  app/screen running against the Yahoo DB exactly as against synthetic.
- **Daily EOD append is idempotent:** a post-close run appends the latest
  bar(s); re-running the same day produces **no duplicate rows** (upsert on
  `(ticker, date)`, matching the importer's existing guarantee).
- **Adjusted close reaches the engine (ADR-005):** the close the engine sees is
  Yahoo's `adjClose`, so split/dividend-spanning windows are correct on close —
  no adjustment logic enters the engine.
- **Coverage / freshness, both reportable per run:** % of the target universe
  fetched successfully, and max staleness (newest bar date vs the last trading
  day) after a daily run. A run that silently drops names is a failure.
- **No secret/credential and no third-party runtime dep checked in** beyond what
  the fetch requires; the fetcher is server/CLI-only and never enters the client
  bundle (mirrors the STORY-032 `node:sqlite` constraint).

## Constraints
- **Personal / non-redistributing deployment only.** Yahoo's unofficial EOD
  endpoints prohibit commercial redistribution; this plan assumes bars are never
  served to third parties. ADR-008 flips **proposed → accepted, scoped to
  non-redistribution**, and the SAD#2.7 disclosure constraint is honoured. A
  redistributable deployment would re-open ADR-008 for a licensed vendor
  (the existing STORY-015 placeholder).
- **Reuse the existing data layer; do not fork it.** Land bars in the STORY-031
  `instrument`/`bar` schema (SAD#6.1) and serve via the STORY-032 provider. Reuse
  the importer's idempotent-upsert + `config.yahoo.json` path rather than
  re-implementing DB writing.
- **Separate SQLite DB.** The Yahoo-sourced DB is a distinct file from the
  synthetic generator and from golden-master fixtures (ADR-007): synthetic stays
  the deterministic test fixture; the Yahoo DB is real-but-personal data,
  selectable via the existing `MARKETDATA_DB` / TopBar data-source path.
- **Adjustment trusted from the source (ADR-005).** Use Yahoo's `adjClose` as
  the engine-visible close; perform **no** corporate-action math in this plan.
  Full per-OHLC back-adjustment is a deferred follow-on (see Non-goals / Open
  questions).
- **Engine purity preserved (SAD#2.6 / ADR-004).** The fetcher is a Node/CLI
  ingestion tool; bars are passed into the engine via the port. No DOM/fetch in
  the engine, no "today" leaking in.
- **Gate-1 precondition (per IDEA-002).** This plan cannot become work until it
  is promoted through `/plan-to-sad PLAN-003 SAD-NNN`: the ADR-008 flip + a SAD
  amendment naming the Yahoo vendor adapter at SAD#4.3 / SAD#5.10 must land
  first.

## Non-goals
(explicit — flows into SAD#1.2 via `/plan-to-sad PLAN-003 SAD-NNN`)
- **No intraday / real-time / streaming.** EOD daily bars only (SAD#1.2
  reaffirmed). No tick, minute, or delayed-quote feeds.
- **No redistribution / no external serving / no accounts.** Bars stay on the
  operator's machine. Multi-tenant or product serving of Yahoo data is OUT and
  would require re-opening ADR-008. This keeps the deployment inside Yahoo's ToS.
- **No full OHLC corporate-action back-adjustment.** Only `adjClose` is used this
  plan. Deriving adjusted open/high/low/volume from split/dividend events is a
  deferred follow-on, not built here.
- **No vendor-agnostic ingestion framework.** One Yahoo fetcher. The port
  (SAD#5.10) already provides swappability; building a pluggable multi-vendor
  abstraction is OUT.
- **No new SQLite schema or store redesign.** Reuse STORY-031's `instrument`/`bar`
  schema (SAD#6.1) and STORY-032's reader verbatim.
- **No engine, rule-semantics, or client changes.** This is data-layer-only work
  upstream of the port. If a story here touches `market.ts` or a component, it
  has left scope.
- **No fundamentals / financials / news / corporate-actions product data.**
  OHLCV + universe metadata (ticker/name/sector) only. (Split/dividend *events*
  may be *stored* for later adjustment — see Open questions — but are not a
  product surface, per SAD#1.2.)
- **No live runtime Yahoo provider.** No fetching at request time, no making the
  port async. Ingestion-to-DB only; the synchronous port is untouched.
- **No universe-discovery / index-membership service.** The set of tickers is a
  supplied list (config/file); computing index constituents is OUT.
- **No scheduling infrastructure.** The daily run is invoked by an external
  trigger (cron / manual / a separate scheduling concern); building a scheduler
  is OUT of this plan.

## Open questions
- **Fetch → DB seam:** does the Yahoo fetcher emit a CSV that the *existing*
  `tools/eod-import` consumes (maximal reuse, clean separation, `config.yahoo.json`
  already fits), or call the importer's `db.ts` writer directly (fewer steps, but
  couples fetch to the writer)? Lean: emit/normalize to the importer's input.
- **Endpoint / library:** which Yahoo access path — the v8 `chart` JSON API, the
  CSV `download` endpoint, or a wrapper like `yahoo-finance2`? Trade-offs in
  stability, rate-limit posture, and whether it adds a runtime dependency
  (constraint: server/CLI-only).
- **adjClose vs raw storage:** store only the adjusted close, or persist **both**
  raw OHLCV and `adjClose` (and split/dividend events) so the deferred full-OHLC
  adjustment can derive without re-fetching? Affects schema fit with STORY-031
  (which today carries a single `c`).
- **Universe definition:** where does the ticker list live, and how large is the
  initial universe (the 44 dev tickers in `metadata.synthetic.json`, or a larger
  real list)? Name/sector metadata source when Yahoo provides none.
- **Backfill depth & resumability:** how many years of history; can a partial /
  interrupted backfill resume without re-fetching everything?
- **Partial-failure policy:** if some tickers fail in a run, commit the partial
  set + report, or fail the whole run? (Ties to the coverage metric.)
- **Rate-limit / politeness:** batch size, inter-request delay, retry/backoff,
  and the risk of IP throttling against an unofficial endpoint.
- **Daily-run trigger & DB lifecycle:** how the post-close run is invoked, the DB
  path/naming convention, and how the TopBar data-source selector surfaces the
  Yahoo DB alongside synthetic.
- **Test strategy:** recorded HTTP fixtures vs live calls in tests, given the
  fetcher hits an external, unstable endpoint (the importer's parse/upsert is
  already fixture-tested).
