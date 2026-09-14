# Börsdata ingestion — implementation plan

Status (2026-09-10): **proposed — phase 0 open**. Adds [Börsdata](https://apidoc.borsdata.se/swagger/index.html)
as a **third data provider** beside `tools/eod-import` (CSV) and `tools/yahoo-fetch` (HTTP);
both keep working, untouched except for one extraction in phase 0. Lands the Nordic
universe, EOD prices, splits and — later, provisionally — KPIs and reports into a separate
`borsdata-market.db`. **Nothing in this plan reaches the UI**: wiring fundamentals into the
screener is a follow-up plan. There is **no API key yet**, so every phase but 4 is
fixture-driven, and phase 4 is a gated live-verification checkpoint rather than a code phase.

## Context

The screener runs on three interchangeable SQLite datasets — `dev-market.db` (Stooq CSV),
`kaggle-market.db`, `yahoo-market.db` — all US-centric, all populated by tools designed for
a world where market data arrives as a file on disk or an unofficial JSON endpoint with no
credential. Mikael wants Nordic coverage from Börsdata, which is a different animal: an
authenticated, rate-limited, well-specified REST API carrying not just OHLCV but the
instrument taxonomy (sector/branch/market/country), corporate actions, financial reports
and ~200 precomputed KPIs.

Three things make this more than "another `yahoo-fetch`":

1. **Identity.** Börsdata keys on `insId` (an integer). The app is keyed on `ticker TEXT`,
   shown in the table. Nordic tickers carry the share class as a space (`ERIC B`, `VOLV B`)
   and **collide across countries** — Nokia trades in both Helsinki and Stockholm.
2. **Shape.** Bars fit `instrument`/`bar` exactly. Reports, KPIs and splits do not fit it at
   all, and there is no migration mechanism — the schema is a `CREATE TABLE IF NOT EXISTS`
   string in `tools/eod-import/db.ts`.
3. **A credential.** The first secret this repo has handled, passed as a **query parameter**
   (`?authKey=…`) — so it lands in every URL, and every URL is one log line from a leak.

The intended outcome: `npm run borsdata -- backfill` produces a `borsdata-market.db` that
`MARKETDATA_DB=borsdata-market.db npm run dev` serves through the **unchanged**
`sqliteProvider`, with fundamentals in side tables ready for a later screener plan to read.

### Decisions taken (Mikael, 2026-09-10) — do not re-open

- Börsdata is an **additional** provider; `eod-import` and `yahoo-fetch` keep working.
- Scope: instruments + metadata, EOD prices, splits, and reports + KPIs.
- Ticker key: **ticker + country suffix**.
- Universe filter: **configurable, defaulting to equities**.
- **No API key yet** — build against fixtures. Obtaining the key is a Mikael action
  (Börsdata MyPage; requires a Nordic **Pro** membership. Pro+ adds Global, unused here).

### The API, in the numbers that matter

Base `https://apiservice.borsdata.se/`, auth `?authKey={KEY}`, **100 calls / 10 s**,
guideline **< 10 000 calls / day**, `429` carries `Retry-After`, data refreshed ~20:00 UTC.
Batch endpoints take `instList` with **max 50** instruments and report per-instrument
`BADINPUT` / `NOTEXIST` / `NOTACTIVE` *inside a 200 response*.

## Design

### 1. Ticker identity — `tools/borsdata-fetch/identity.ts`

**The app ticker is `RAWTICKER.CC`** — Börsdata's ticker verbatim, uppercased, whitespace
collapsed, plus `.` and a two-letter country code: `ERIC B.SE`, `VOLV B.SE`, `NOKIA.FI`,
`NOKIA.SE`, `NOVO B.DK`. `insId` is persisted in `borsdata_instrument` as the provider key
and is never the app key.

**The space survives.** The obvious instinct is `ERIC-B.SE`, but nothing needs it:
`src/lib/client/marketClient.ts:188` already sends `fetch('/instrument/' + encodeURIComponent(ticker))`
and `server/index.ts:146` decodes it, there is no client route carrying a ticker, and the
importer's `parseCSV` handles quoted fields. `ERIC B` is what a Swedish user calls it, and
collapsing separators invents new collisions (`X B` vs `XB`). Börsdata's own `yahoo` field
(`ERIC-B.ST`) is stored alongside as the bridge to `yahoo-market.db`.

**The country suffix is not optional.** Under a raw-ticker key the two Nokias would have
their bars interleaved by `ON CONFLICT(ticker,date) DO UPDATE` and their names flapped by
`ON CONFLICT(ticker)` — data corruption presented as a successful import. The repo's
loudest invariant is that a ticker is never silently *dropped*; silently *merged* is worse.
Country rather than market (`.STO`/`.HEL`) because `marketId` is provider-internal and
re-issuable, while country is stable and there are only 4–5 Nordic values.

**`/v1/countries` returns `{id, name}` with no ISO code**, so the suffix cannot come from
the API alone. A hand-authored `tools/borsdata-fetch/country-codes.json` maps
`countryId → {code, name}`. Resolution: `instrument.countryId` → the map; if null, fall
back via `markets[marketId].countryId`; if still unresolved, **exclude the instrument and
name it in the run report** — never a blank or guessed suffix. The map is verified against
live `/v1/countries` as the first task of phase 4.

```ts
export function appTicker(rawTicker: string, countryCode: string): string;
export function resolveIdentities(
  instruments: InstrumentV1[], ref: ReferenceData,
  opts: { allowedTypes: ReadonlySet<number>; overrides?: Record<string, string> },
): IdentityReport;

export interface IdentityReport {
  resolved: ResolvedInstrument[];
  renamed:  { insId: number; wanted: string; assigned: string }[];
  excluded: { insId: number; rawTicker: string; reason: 'instrument-type' | 'no-country' | 'blank-ticker' }[];
}
```

**Residual collisions** (same ticker, same country, different `insId` — pref/stock pairs,
some dual listings) resolve deterministically: sort candidates by `insId` ascending, the
lowest keeps the clean key, the rest become `TICKER.CC#<insId>`. Every rename is listed in
`renamed` and printed. Order-independent, never silent. An operator who wants something
prettier pins it in the config's `tickerOverrides`.

**The universe filter is a scope decision.** `InstrumentV1.instrument` has 14 values;
ingesting all of them puts currencies, commodities, crypto and index series into a *stock*
screener, where every indicator in `market.ts` computes happily and means nothing. Default
`allowedTypes = {0, 1, 3}` (Stocks, Pref, Stocks2). SPAC/ADR/Unit (8/9/10) are opt-in;
indices (2/11/13), sectors/industries (4/5) and currencies/commodities/crypto (6/7/12) are
off. Every exclusion is named in the report.

### 2. Schema — `tools/borsdata-fetch/schema.ts` + `db.ts`

**One DB file, `borsdata-market.db`. Two writers, disjoint table sets.**
`tools/eod-import/db.ts` keeps sole ownership of `instrument` and `bar` and its `SCHEMA`
constant is **not edited** — no new columns on `instrument`, ever.
`tools/borsdata-fetch/db.ts` (`BorsdataDatabase`) owns every `borsdata_*` table and nothing
else. This is ADR-002's actual invariant — *one idempotent write path per table* — rather
than its letter, which would force reports through a CSV that has no shape for them.

Same file rather than a separate `borsdata-fundamentals.db` because `sqliteProvider`
(`src/lib/data/sqlite.ts:66`) and `server/devDataset.ts:52` both validate only that
`instrument` and `bar` exist and select only named columns. **Extra tables are invisible to
them**, so the Börsdata DB is servable and appears in the dev DB-switcher for free — and
fundamentals are only useful joined to prices by ticker.

`node:sqlite` is synchronous, so the run sequence is strictly sequential:
`BorsdataDatabase` open → write → close, then `runImport()` (which opens its own handle and
closes it), then reopen for the watermark. **Never hold both handles at once.**

```sql
-- migration 1 — baseline
CREATE TABLE IF NOT EXISTS borsdata_sync_state (
  key TEXT PRIMARY KEY,          -- 'schema.version' | 'splits.from' | 'prices.last_run' | 'kpis.as_of'
  value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS borsdata_instrument (
  ins_id INTEGER PRIMARY KEY,    -- the PROVIDER key, immutable
  ticker TEXT NOT NULL,          -- the APP key, == instrument.ticker
  raw_ticker TEXT NOT NULL,      -- 'ERIC B', verbatim
  name TEXT NOT NULL, url_name TEXT, isin TEXT,
  yahoo TEXT,                    -- cross-provider bridge to yahoo-market.db
  instrument_type INTEGER NOT NULL,
  sector_id INTEGER, sector_name TEXT,
  branch_id INTEGER, branch_name TEXT,
  country_id INTEGER, country_name TEXT, country_code TEXT,
  market_id INTEGER, market_name TEXT, exchange_name TEXT, is_index INTEGER,
  listing_date TEXT, stock_price_currency TEXT, report_currency TEXT,
  updated_at TEXT,               -- from /v1/instruments/updated
  fetched_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS borsdata_instrument_ticker ON borsdata_instrument (ticker);

CREATE TABLE IF NOT EXISTS borsdata_split (
  ins_id INTEGER NOT NULL, date TEXT NOT NULL, factor REAL NOT NULL, ticker TEXT NOT NULL,
  PRIMARY KEY (ins_id, date)
);
CREATE TABLE IF NOT EXISTS borsdata_kpi_metadata (
  kpi_id INTEGER PRIMARY KEY, name_en TEXT, name_sv TEXT, format TEXT, is_string INTEGER
);
CREATE TABLE IF NOT EXISTS borsdata_kpi_value (
  ins_id INTEGER NOT NULL, kpi_id INTEGER NOT NULL,
  calc_group TEXT NOT NULL, calc TEXT NOT NULL,   -- 'last'/'latest', '5year'/'mean', …
  ticker TEXT NOT NULL, n REAL, s TEXT, as_of TEXT NOT NULL,
  PRIMARY KEY (ins_id, kpi_id, calc_group, calc)
);
CREATE TABLE IF NOT EXISTS borsdata_report (
  ins_id INTEGER NOT NULL, kind TEXT NOT NULL,    -- 'year' | 'r12' | 'quarter'
  year INTEGER NOT NULL, period INTEGER NOT NULL, ticker TEXT NOT NULL,
  revenues REAL, gross_income REAL, operating_income REAL, profit_before_tax REAL,
  profit_to_equity_holders REAL, earnings_per_share REAL, number_of_shares REAL, dividend REAL,
  intangible_assets REAL, tangible_assets REAL, financial_assets REAL, non_current_assets REAL,
  cash_and_equivalents REAL, current_assets REAL, total_assets REAL,
  current_liabilities REAL, non_current_liabilities REAL, total_liabilities REAL, equity REAL,
  return_on_equity REAL, return_on_assets REAL, debt_to_equity REAL,
  currency TEXT, fetched_at TEXT NOT NULL,
  PRIMARY KEY (ins_id, kind, year, period)
);
```

Every table carries **both** `ins_id` (the join key inside the Börsdata world) and `ticker`
(the join key to `instrument`/`bar`), so re-keying later is one `UPDATE … SET ticker` per
table rather than a re-fetch. Numeric columns are **nullable**: Börsdata omits fields that
do not apply, and coercing a bank's missing `gross_income` to `0` is a lie a future
screener would filter on. `CREATE UNIQUE INDEX` is a new precedent for this repo (it has
none) and earns it — ticker uniqueness is a correctness invariant, and letting the DB
enforce it turns an identity bug into a write-time constraint violation instead of silent
data loss.

**Migration story, in order of how much it matters.** First, *the best migration is the one
you never write*: no Börsdata field goes onto `instrument`, precisely because
`CREATE TABLE IF NOT EXISTS` cannot add a column and the existing `.db` files would be
silently stale-schema'd. Second, a ~30-line migrator for the `borsdata_*` tables, which will
evolve: `MIGRATIONS: readonly {version, sql}[]`, bootstrap `borsdata_sync_state`, read
`schema.version` (absent → 0), apply everything newer in one transaction. Authors may only
`CREATE TABLE`, `CREATE INDEX`, or `ALTER TABLE … ADD COLUMN` with a nullable column —
SQLite forbids a non-constant default and anything needing a table rebuild is out. Third,
the escape hatch, documented in the README: ingestion is idempotent and cheap (~250 calls,
minutes), so `rm borsdata-market.db && npm run borsdata -- backfill` is always valid.

### 3. The write path — `tools/borsdata-fetch/ingest.ts`

| Data | Path | Writer |
| --- | --- | --- |
| bars → `bar`, names/sectors → `instrument` | fetch → normalise → temp CSV → `runImport()` | `tools/eod-import/db.ts` (unchanged) |
| instrument metadata, splits, reports, KPIs, sync state | fetch → normalise → typed rows | `tools/borsdata-fetch/db.ts` |

**Prices go through the CSV seam**, mirroring `tools/yahoo-fetch/backfill.ts:81-119`
exactly. Header: `Company,Date,Open,High,Low,Close,Volume,Name,Sector` — the extra columns
exploit the importer's existing `ColumnMapping.name`/`.sector` (`run.ts:72-86`), so unlike
`config.yahoo.json` there is **no hand-maintained metadata side file**; Börsdata supplies
name and sector per instrument. There is no `adjClose` column because Börsdata has no
separate adjusted series — `c` goes straight into `Close` (see §6 for why that is legitimate
and how it gets verified).

`tools/borsdata-fetch/config.borsdata.json` lives in **the tool's own directory, not
`tools/eod-import/`**. `server/devImport.ts:88` auto-discovers `^config.*\.json$` under
`tools/eod-import` and would offer a Börsdata config in the dev import modal, where it is a
trap — the modal browses `EOD_DATA_DIR` for CSVs no human would hand-produce in this shape.
`loadConfig()` takes an absolute path and `metadataFile` resolves relative to the config's
own directory, so nothing else cares. Config: the mapping above, `dateFormat: "iso"`,
`ticker: {case: "upper"}` and **no `stripSuffix`**, so the country suffix survives.

**Extracted vs duplicated.** Phase 0 lifts the genuinely shared machinery to `tools/shared/`
while keeping yahoo-fetch's public surface byte-identical:

```ts
// tools/shared/http.ts
export interface HttpResponse { status: number; body: string; headers?: Readonly<Record<string,string>> }
export type HttpFetch = (url: string, init?: {...}) => Promise<HttpResponse>;
export const nodeFetch: HttpFetch;
export function backoffMs(base: number, attempt: number): number;
export function retryAfterMs(res: HttpResponse, now?: () => number): number | null;  // NEW
export function getWithRetry(url: string, opts: RetryPolicy & {http?: HttpFetch; label?: string}): Promise<HttpOutcome>;

// tools/shared/freshness.ts — moved verbatim out of yahoo-fetch/coverage.ts
export function lastTradingDay(asOf: Date): Date;
export function stalenessDays(newestBarDate: string, lastTrading: Date): number;
export function newestBarDate(dbPath: string): string | null;
```

`tools/yahoo-fetch/fetch.ts` re-exports the types and **keeps `TRANSIENT_STATUS` local**,
because its inclusion of `403` is a Yahoo fact (bot-throttling) and for Börsdata `403` means
*bad API key* — retrying it three times is exactly wrong. That divergence is the reason the
code is extracted rather than imported. `fetch.test.ts` and `coverage.test.ts` passing
**unmodified** is the phase-0 gate.

The coverage/report *shape* is deliberately duplicated: Börsdata's report carries
per-`insId` outcomes, the batch error codes, the excluded/renamed lists from §1 and the API
call budget spent. ~60 lines of formatting is cheaper than a generic report type serving
neither well. The pure parts — where the actual logic is — are shared.

`tools/borsdata-fetch` imports `tools/eod-import/{config,run}.ts` only, never
`tools/yahoo-fetch/*`; coupling two vendor tools would inherit the wrong 403 policy.

### 4. The API key — `tools/borsdata-fetch/auth.ts`

| | |
| --- | --- |
| **Primary** | `BORSDATA_API_KEY` |
| **Fallback** | `BORSDATA_API_KEY_FILE` — path to a file containing only the key (read + `trim()`) |
| **Read in** | `auth.ts`, one function, `env` as a defaulted parameter (matching `server/universe.ts`) |
| **Not supported** | `.env` files, dotenv, any hand-rolled env parser |

The file variant is four lines and keeps the key out of shell history and `ps` output, which
matters more than `.env` ergonomics. Adding dotenv as this repo's first credential mechanism,
in a tooling layer with zero third-party dependencies, is not worth it.

**The key is kept out of logs structurally, not by scrubbing.** `parse.ts` builds
path+query **without** the key; `auth.sign()` adds it inside `fetch.ts` on the single line
before the call.

```ts
export class MissingApiKeyError extends Error {}
export interface Authenticator {
  sign(pathAndQuery: string): string;   // the ONLY place the key enters a string
  label(pathAndQuery: string): string;  // authKey=REDACTED — everything printed uses this
}
export function authenticator(key: string, base?: string): Authenticator;  // key lives ONLY in the closure
export function authenticatorFromEnv(env: NodeJS.ProcessEnv = process.env, base?: string): Authenticator;
export function redactUrl(url: string): string;
```

What follows from that shape: `Authenticator` has **no getter**, so `JSON.stringify(auth)`
is `{}` and a stray `console.log(auth)` prints nothing. The pure layer *cannot* leak the key
because it never receives one — failures, reports and test assertions are built from
`auth.label(path)` or the raw path, which is also why tests need no key at all. `redactUrl`
is defence in depth at every report boundary. The Börsdata `nodeFetch` variant sets
`redirect: 'error'`, because a redirect to another host forwards the query string. The key
never reaches the DB, `.dev-active-db`, the config, or any file the tool writes.

`.gitignore` gains `.env`, `.env.*`, `*.key`, `.borsdata-key` — guarding against a key file
the tool does not itself read.

`npm run borsdata -- key-check` is the gated live entry point: one `GET /v1/countries`,
printing `ok — <n> countries` or `403 — key rejected or missing`.

### 5. Rate limiting and the call budget — `throttle.ts`

Nordic universe ≈ 1 800 instruments after the type filter (an estimate to be confirmed in
phase 4); `ceil(1800/50) = 36` batches.

| Operation | Calls |
| --- | --- |
| `/v1/instruments` + `/branches` + `/sectors` + `/countries` + `/markets` | 5 |
| **Prices, 20 y backfill @ 5-year windows** | **144** (4 × 36) |
| Prices, 20 y @ 1-year windows (defensive fallback) | 720 |
| **Prices, daily delta** — `/stockprices/last`, whole universe | **1** |
| Prices, gap fill (> 1 day behind) | 36 |
| `/instruments/StockSplits?from=` | 1 |
| Re-fetch after splits (~5 names/day) | 1–4 |
| KPI values, 20 KPIs × 3 calc variants (whole universe per call) | 60 |
| `/kpis/metadata` + `/kpis/updated` | 2 |
| Reports, full history (`year` + `r12` + `quarter` in one response) | 36 |

**Full cold start ≈ 247 calls — 2.5 % of the daily guideline. Daily delta ≈ 9 calls**
(≈ 69 with a KPI refresh). At ~10 calls/s that is 25 seconds of wall clock: time is not the
constraint, memory is (§7 of Phases). The per-instrument `/instruments/{insid}/stockprices`
path is the one budget hazard — 1 800 calls per window, 72 % of the daily budget for a
4-window backfill. Gate it behind `--per-instrument` and require `--yes` above 2 000
projected calls.

**Paging / `maxCount`.** The batch endpoint's behaviour over a 20-year range is undocumented,
so window defensively and detect truncation empirically:

```ts
export function priceWindows(from: string, to: string, yearsPerWindow: number): DateWindow[];
export function isTruncated(bars: BorsdataBar[], window: DateWindow,
                            listingDate: string | null, opts?: {toleranceDays?: number}): boolean;
```

`isTruncated` is true when the oldest returned bar is well after `window.from` **and** is not
within a few days of `listingDate` — that field is the clean discriminator between "history
starts here" and "the response was capped". On truncation the window halves and retries,
bounded to four levels, then surfaces as a named `truncated` failure. Default
`--years-per-window 5`.

**A token bucket, not `batchSize`/`delayMs`.** Börsdata's limit is a global sliding-window
*rate*, not a concurrency cap. `{batchSize: 5, delayMs: 500}` satisfies it by accident and
breaks the moment a run interleaves two endpoint loops — which the daily run does (prices +
splits + KPIs). One `Throttle` threaded through every call site is correct under any
interleaving, and `spent()` makes the budget observable in the report.

```ts
export interface Throttle { acquire(): Promise<void>; penalise(ms: number): void; spent(): number }
export function tokenBucket(opts?: {
  capacity?: number;      // default 90  (documented 100 — headroom for clock skew / other clients)
  refillPerSec?: number;  // default 9   (documented 10/s)
  now?: () => number; sleep?: (ms: number) => Promise<void>;   // injectable — tests never really wait
}): Throttle;
```

**`Retry-After` beats exponential backoff**, which yahoo's fetcher cannot do because it
discards headers. `HttpResponse` gains optional lower-cased `headers`;
`retryAfterMs` handles both the seconds form and the HTTP-date form, falling back to
exponential on garbage. A wait above a 60 s cap fails rather than hangs. A `429` also calls
`throttle.penalise(wait)` so every *other* loop backs off too.

**`403` is permanent and fatal to the whole run** — not retried, not reported per-instrument.
It aborts with guidance naming `BORSDATA_API_KEY` and `key-check`. Retrying it across 36
batches would burn 108 calls and produce 1 800 bogus per-instrument failures.

### 6. Splits and re-fetch — `splits.ts`, `daily.ts`

```
1. from    := state('splits.from') ?? (newest bar in `bar` − 7 days) ?? --history-start
2. splits  := GET /v1/instruments/StockSplits?from={from}                      [1 call]
3. resplit := { insId : any split date > from }
4. for insId in resplit:  re-fetch FULL history → CSV → runImport
                          → ON CONFLICT(ticker,date) DO UPDATE replaces every prior bar in place
5. otherwise:  one trading day behind → GET /stockprices/last   [1 call, all names]
               further behind         → batch /stockprices?from=<newest bar>
6. on success, in ONE transaction: splits rows + state('splits.from') + state('prices.last_run')
```

Step 4 is the payoff for honouring the CSV/upsert seam: a full-history re-fetch **replaces**
rather than duplicates, with no `DELETE` and no second write path. That is the concrete
reason ADR-002 earns its keep here.

**Whether Börsdata retro-adjusts prices is the load-bearing unknown, and it is answered
empirically rather than guessed.** Ship a verification mode instead of adjustment math:

```ts
export function classifySplit(factor: number, ratio: number | null): 'adjusted' | 'not-adjusted' | 'inconclusive';
```

`ratio` is `close(d−1) / close(d)` from the stored bars. `ratio ≈ factor` means the series
has a discontinuity at the split → **not adjusted**; `ratio ≈ 1` → **adjusted**. Run
`npm run borsdata -- verify-splits` once after the first live backfill and **record the
verdict in this document and the diary**. If "not adjusted", that spawns a follow-up phase
with a pure `adjustForSplits(bars, splits)` applied at CSV-emit time — still through the
seam, still at ingestion, consistent with ADR-005. If "adjusted" (likely, for a paid
provider), the split table remains a re-fetch trigger and an audit record. **No adjustment
math ships before that verdict is written down.**

**Run state lives in `borsdata_sync_state`, in the same DB file** — not a JSON sidecar. It
must move with the data (copy or delete the DB and a sidecar goes stale, silently
under-fetching the next split window) and it must be transactional (`writeSplits(rows,
watermark)` commits both together, so a crash never advances the watermark past data that
was not written). `--since <date>` overrides it; `--force-full` ignores it.

## Phases

One branch/PR each, green on `npm run typecheck && npm test && npm run lint`.

| # | Phase | Key? | Delivers | Touch scope |
| --- | --- | --- | --- | --- |
| 0 | **`tools/shared/` extraction** | no | Yahoo tooling gains `Retry-After`; the existing suite passing **unmodified** is the gate | `tools/shared/{http,freshness}.ts` (new), `tools/yahoo-fetch/{fetch,coverage}.ts` (re-export), `CLAUDE.md` (drop the stale Python-tooling line) |
| 1 | **Instruments + reference data + identity** | no | `borsdata -- instruments` prints the resolved universe, every rename, every exclusion — the §1 design proven before anything depends on it | `tools/borsdata-fetch/{parse,identity,auth,throttle,fetch,schema,db,instruments,index}.ts`, `country-codes.json`, `fixtures/`, `README.md`, `package.json`, `.gitignore` |
| 2 | **Price backfill** | no | **Makes `MARKETDATA_DB=borsdata-market.db npm run dev` work.** The highest-value phase | `tools/borsdata-fetch/{prices,ingest,coverage}.ts`, `config.borsdata.json` |
| 3 | **Splits + daily delta + sync state** | no | Keeps the DB current at ~9 calls/day; `verify-splits` ready to run | `tools/borsdata-fetch/{splits,daily}.ts`, `db.ts` (state + splits) |
| 4 | **LIVE SMOKE** | **YES — blocked** | Not a code phase; the gated procedure below | fixtures corrected; this doc + the diary record the split verdict |
| 5 | **KPIs** *(provisional)* | verified in 4 | Screenable fundamentals, precomputed, 1 call each | `tools/borsdata-fetch/kpis.ts`, `db.ts` |
| 6 | **Reports** *(provisional)* | verified in 4 | Raw fundamentals for ratios no KPI provides | `tools/borsdata-fetch/reports.ts`, `db.ts` |

**Phase 4 procedure** — the only key-blocked step:
1. `npm run borsdata -- key-check`.
2. Verify `country-codes.json` against live `/v1/countries`; correct it.
3. `npm run borsdata -- backfill --from 2020-01-01 --tickers "ERIC B.SE,NOKIA.FI,NOKIA.SE,NOVO B.DK"`
   — 5 names, ~8 calls. **Diff every fixture against the live response and correct any that
   were wrong.**
4. Full Nordic backfill; watch the call counter and the truncation detector. Record the real
   instrument and bar counts back into this document.
5. `npm run borsdata -- verify-splits` → record the verdict here and in the diary.
6. Open the app against the DB; confirm the ticker keys read sanely in the table.

Phases 5–6 are buildable on fixtures before phase 4 but **should not land before it**: if
the fixtures are wrong, phase 4 corrects them, and correcting a fixture three phases already
assert against is three PRs of churn instead of one.

**Two pushbacks on the stated scope, for Mikael to take or leave:**

1. **KPIs before reports, and reports possibly not at all yet.**
   `/kpis/{id}/{group}/{calc}` returns P/E, P/B, EV/EBIT, ROE, revenue growth and market cap
   for the *whole universe in one call each*, precomputed. `borsdata_report` is ~24 nullable
   columns × 3 kinds × 20 years ≈ 100 k+ rows whose main purpose is computing ratios Börsdata
   already computed. If the goal is "ready for a later screener phase", **KPIs are that
   readiness and reports are not** — including `sharesOutstanding`, which KPI 50 covers.
   Reports are ordered last here and marked provisional rather than dropped.
2. **Fundamentals with no consumer is speculative either way.** The stronger sequence is
   0–4, confirm prices end to end against the real API, *then* decide 5/6 with a key in hand.

## Tests

Style follows the existing tooling tests exactly: injected `HttpFetch`, injected `sleep` and
`now`, real temp SQLite DBs via `mkdtempSync`, no live network, no mocking library.

**Fixtures are HAND-AUTHORED from the published schema, and `fixtures/README.md` must say so
plainly** — they encode our *reading* of the documented response shapes, not the API's
behaviour. That README is both the honest marker that phases 1–3 are green against a belief
and the phase-4 re-recording checklist, with a `curl` line per fixture.

`instruments.json` carries six instruments chosen to be adversarial: a plain SE stock, a Pref
(type 1), **the NOKIA SE/FI collision pair**, a name containing a comma (CSV quoting), one
with null `isin`/`yahoo`/`countryId`, and one of an excluded type. Alongside it:
`stockprices.batch.json` (terse keys, one `NOTEXIST`, one empty), `stockprices.last.json`,
`stockprices.truncated.json` (oldest bar inside `from`, with a `listingDate` proving it is
not the start of history), `stocksplits.json` (a 2:1 and a reverse), `reports.batch.json`
(one `NOTACTIVE`, one with null numerics), the KPI metadata/numeric/string trio, and
`error.{403,429}.json`.

| File | Asserts |
| --- | --- |
| `parse.test.ts` | every path builder produces the documented path and **contains no `authKey`**; `instList` **throws above 50 rather than truncating**; terse `{d,c,h,l,o,v}` → `{date,o,h,l,c,v}`; a `d` with a time component normalises; per-instrument `error` codes become structured reasons and the instrument still appears in the outcomes; null report numerics stay `null`, never `0`; `isString` KPIs land in `s` |
| `identity.test.ts` | `ERIC B` + SE → `ERIC B.SE`; the two NOKIAs stay distinct; same-ticker-same-country → lowest `insId` keeps the clean key and both appear in `renamed`; null `countryId` falls back via `marketId`; an unmappable country is **excluded by name**; excluded types reported; **shuffled input produces identical keys** |
| `auth.test.ts` | `authenticatorFromEnv({})` throws naming both env vars; `_FILE` reads and trims; `label()`/`redactUrl()` show `REDACTED`; `JSON.stringify(auth)` exposes nothing |
| `throttle.test.ts` | injected clock: 90 immediate acquires, the 91st sleeps; sustained ≤ 9/s over a simulated minute; `penalise` delays subsequent acquires; `spent()` matches |
| `fetch.test.ts` | `429` + `Retry-After: 3` sleeps **3000 ms, not `backoffMs`**; HTTP-date form works; garbage falls back to exponential; above the cap it fails rather than hangs; **`403` fails immediately with `attempts === 1`**; `500` retries to the bound; 137 ids chunk 50/50/37 |
| `prices.test.ts` | `priceWindows` tiles with no gap or overlap; `isTruncated` true for the truncated fixture and **false when the oldest bar matches `listingDate`**; a truncated window halves once and gives up as a named failure after four levels |
| `backfill.test.ts` | real temp DB; `instrument`/`bar` carry the suffixed tickers; **`sqliteProvider(dbPath).getUniverse()` returns them** — the end-to-end proof the DB is servable; a second run is byte-idempotent; the call count for a 20-year range matches the §5 table |
| `daily.test.ts` | a split triggers a **full-history** re-fetch for that instrument only (assert its `from`) while others take `/stockprices/last`; the watermark advances only on success; a forced mid-run throw leaves it unmoved |
| `db.test.ts` | a v0 file gets the baseline and a recorded version; re-opening is a no-op; a new migration applies alone; `writeSplits` rolls back rows *and* watermark on a forced error; the unique ticker index rejects a duplicate |
| `splits.test.ts` | `classifySplit(2, 2.01)` → `'not-adjusted'`; `classifySplit(2, 1.003)` → `'adjusted'`; missing neighbour → `'inconclusive'` |
| `leak.test.ts` | **the key never appears** in stdout, stderr, any failure message or the formatted report, across the 403 / 429 / network-throw / malformed-body paths |
| `coverage.test.ts` | every requested `insId` appears exactly once as fetched or failed; every rename and exclusion is named; the API budget line is present; exit 1 below `--min-coverage` |

`server/*` and `tests/*` gain **no new tests** — nothing on the read side or the HTTP surface
changes.

## Verification

- After every phase: `npm run typecheck`, `npm run test`, `npm run lint`.
- Phase 0: the yahoo-fetch suite passes **unmodified**. That is the whole gate.
- Phase 1: `npm run borsdata -- instruments --out borsdata-market.db`, then
  `sqlite3 borsdata-market.db 'SELECT COUNT(*), COUNT(DISTINCT country_code) FROM borsdata_instrument'`.
- Phase 2: `MARKETDATA_DB=borsdata-market.db npm run dev` — the screener runs against Nordic
  names with **no app code change**. Spot-check a chart for `ERIC B.SE`.
- Phase 3: two consecutive `npm run borsdata -- daily` runs add no duplicate rows;
  `borsdata_sync_state` advances once.
- Phase 4: the six-step procedure above. Write the measured numbers and the split verdict
  back into this document.

Everything above phase 0 is verifiable against fixtures without a key; the `npm run
borsdata` invocations that hit the network are phase-4 gated.

## Risks

- **Every fixture is a guess until phase 4** — terse-key names, where the batch `error` field
  sits, whether `d` carries a time, whether `from` is honoured over 20 years. → the fixtures
  README, and phase 4 step 3 diffing live responses before the full run.
- **`/v1/countries` has no ISO code**, so the ticker key depends on a hand-authored map that
  cannot be validated offline. → unmapped means excluded by name, never guessed; verified
  first thing in phase 4.
- **Split adjustment is unanswerable offline.** → `verify-splits`, and a hard rule that no
  adjustment math ships before its verdict is recorded here.
- **`runImport` accumulates every bar in memory** before one `BEGIN`/`COMMIT`
  (`run.ts:97`). Today's largest dataset is 603 k bars / 54 MB; 1 800 names × 20 y ≈ 9 M
  bars. → **one `importPrices` call per price window**, not per run: 4 windows × 36 batches
  is ~2.2 M bars per transaction. If still too much, drop to per-batch (36 transactions).
  **Do not change `runImport`** — change the call granularity. Measure in phase 2 against a
  synthetic 9 M-bar fixture before phase 4 hits it for real.
- **Ticker keys are effectively permanent once a DB exists** — changing the scheme later
  means rebuilding. Phase 1 exists so that decision is exercised and reviewed before phase 2
  writes a single bar.
- **The key is a query parameter.** → paths never carry it, `leak.test.ts` enforces it, and
  `BORSDATA_API_KEY_FILE` keeps it off command lines.
- **Currency is not modelled anywhere in the schema.** → a separate `borsdata-market.db`, so
  SEK/NOK/DKK/EUR prices never share a universe with USD ones. Cross-country market-cap
  comparison *inside* the Nordic DB is still wrong; KPI 50 has `last/sek` and `last/usd`
  variants and phase 5 should pick one currency.
- **`CLAUDE.md` is stale** — it claims a Python tooling layer that no longer exists, and
  names `dev-market.db` as the dev DB while `.dev-active-db` points at `kaggle-market.db`.
  Phase 0 is already touching tooling docs; fix it there.

## Out of scope (deliberately)

Global (Pro+) instruments and the global price endpoints; insider holdings, short positions
and buybacks; the report and dividend calendars; company descriptions; KPI *history* (as
opposed to the screener snapshot); any scheduler — the daily run is single-shot, triggered by
cron or by hand, matching ADR-008; and any new server endpoint, so `vite.config.ts` and
`tests/dev-proxy-coverage.test.ts` stay untouched (a future `/dev/borsdata` surface would
need a proxy entry or that guard test fails).

Most importantly: **any screener field, filter, column or UI that reads the fundamentals
this plan ingests.** That is a follow-up plan, and it should be written only once there is
real data to look at. The nearest thing to a bridge is
`InstrumentBars.sharesOutstanding` (`src/lib/market.ts:116`), which drives `marketCap` and
is `null` on every real dataset today because no importer has ever supplied it —
`src/lib/data/sqlite.ts` would need to `LEFT JOIN borsdata_instrument` when that table
exists, without breaking the DBs that have no `borsdata_*` tables.
