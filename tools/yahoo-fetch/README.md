# Yahoo EOD fetcher (STORY-050)

The network front-end for the EOD market-data work (`SAD-003#5.1`,
`CAP-eod-fetch`). Given a ticker and a date range it pulls daily OHLCV — plus the
adjusted close — from the Yahoo **v8 `chart` JSON endpoint** (`SAD-003#8.3 /
ADR-003`) using Node's built-in `fetch`, and normalises the response into daily
rows. This is the **per-ticker fetch primitive only**.

The downstream pieces are separate stories: the daily post-close append is
STORY-052 and run-level coverage / freshness reporting is STORY-053. This tool
produces the structured per-ticker results those stories consume. The fetch →
importer ingest seam (STORY-051) ships here as `backfill.ts` — see below.

## Scope & assumptions (binding)

- **Server/CLI-only** (`SAD-003#2.5`). All network I/O lives here; this module
  must never enter the client bundle, and it checks in **no secret/credential**.
- **No third-party Yahoo wrapper** as a runtime dependency (`SAD-003#8.3 /
  ADR-003`) — only Node's built-in `fetch`.
- **No corporate-action arithmetic** (`SAD-003#2.3 / ADR-004`). Yahoo's
  `adjClose` is carried through as data, kept **distinct from** raw `close`.
  Mapping `adjClose` → the importer's close column (`bar.c`) is STORY-051.
- **Tests use recorded HTTP fixtures; no live network in CI** (`SAD-003#8.6 /
  ADR-006`). The HTTP layer is injectable for exactly this reason.

## Usage

```sh
node tools/yahoo-fetch/index.ts --from 2024-01-01 --to 2024-02-01 AAPL MSFT
# or via the npm script:
npm run yahoo:fetch -- --from 2024-01-01 --to 2024-02-01 AAPL MSFT
```

The CLI prints the structured results (success bars + every failure) as JSON to
stdout, prints a failure summary to stderr, and exits non-zero if any ticker
failed. The run-level coverage threshold / exit policy is STORY-053.

| Option | Meaning |
| --- | --- |
| `-f, --from` | Start date (inclusive), ISO `YYYY-MM-DD`. **Required.** |
| `-t, --to` | End date (inclusive), ISO `YYYY-MM-DD`. **Required.** |
| `-b, --batch-size` | Tickers fetched concurrently per batch (default 1). |
| `-d, --delay-ms` | Inter-batch delay in ms (default 0). |

## Backfill → existing importer → SQLite (STORY-051, `SAD-003#5.2`)

`backfill.ts` is the **fetch → import seam** (`CAP-eod-ingest`). Given a
**supplied** ticker list + a historical range it fetches each ticker (reusing the
primitive above), **normalises the successful rows into the importer's CSV input**,
and runs the **existing** `tools/eod-import` with `config.yahoo.json` to land them
in the `SAD-001#6.1` `instrument`/`bar` schema. Per `ADR-002` it emits the CSV and
invokes the importer's `runImport` — it never calls the importer's `db.ts` writer,
so there is exactly **one** idempotent write path.

```sh
node tools/yahoo-fetch/backfill.ts --from 2024-01-01 --to 2024-02-01 AAPL MSFT
# or a supplied ticker file (one ticker per line, # comments allowed):
npm run yahoo:backfill -- --from 2024-01-01 --to 2024-02-01 --tickers universe.txt
```

| Option | Meaning |
| --- | --- |
| `-f, --from` / `-t, --to` | Range (inclusive), ISO `YYYY-MM-DD`. **Required.** |
| `-T, --tickers` | File of tickers, one per line (`#` comments allowed). |
| `-o, --out` | Output SQLite DB. Defaults to `yahoo-market.db` (see below). |
| `-b, --batch-size` / `-d, --delay-ms` | Politeness knobs, as for `yahoo:fetch`. |

**Column mapping** (into the unchanged schema, `SAD-003#6.1` / `ADR-004`):

| Yahoo field | CSV column (`config.yahoo.json`) | DB column |
| --- | --- | --- |
| `adjClose` | `Close` | `bar.c` — the **adjusted** close the engine sees |
| `open` / `high` / `low` | `Open` / `High` / `Low` | `bar.o/h/l` — **raw** |
| `volume` | `Volume` | `bar.v` — raw |
| ticker | `Company` | `bar.ticker` / `instrument.ticker` |

No corporate-action arithmetic is performed — only the close is adjusted; raw OHL
are **not** back-adjusted across splits (the documented `SAD-003#6.1` limitation).
Name/sector are resolved by the importer's existing precedence (CSV column →
`config.yahoo.json`'s `metadata.synthetic.json` → default), since Yahoo carries
neither.

### Output DB path & selection (`SAD-003#6.2`)

The Yahoo-sourced DB defaults to **`yahoo-market.db` at the repo root** — a stable,
documented path **distinct** from the synthetic generator (which has no file), the
EOD dev-import default (`dev-market.db`), and golden-master fixtures. It is
gitignored (`*.db`). Serve it through the **existing** `sqliteProvider` with **no**
code change by pointing `MARKETDATA_DB` at it:

```sh
MARKETDATA_DB=yahoo-market.db npm run dev
```

Re-running a backfill against the same DB is **idempotent** — the importer upserts
on `(ticker, date)`, so no duplicate rows are added (`SAD-003#2.2`).

## Politeness (`SAD-003#2.7`)

The fetcher hits an unofficial endpoint, so it fetches politely:

- **Bounded retry/backoff** on transient failures (thrown network errors and
  transient HTTP statuses `429/500/502/503/504`): exponential backoff up to
  `maxAttempts` (default 3), then the failure is surfaced. Permanent failures
  (not-found / malformed / other non-2xx) are **not** retried.
- **Configurable batch size + inter-batch delay** in the `fetchTickers` helper,
  to bound the request rate across a universe.

## Public surface

`parse.ts` (pure):

- `buildChartUrl(ticker, range, host?) → string`
- `parseChart(body) → ParsedChart` — `{ ok: true, bars: YahooDailyBar[] }` or
  `{ ok: false, reason: 'not-found' | 'empty' | 'malformed', message }`
- `YahooDailyBar = { date, open, high, low, close, adjClose, volume }`
- `DateRange = { from: Date, to: Date }`

`fetch.ts` (injectable HTTP + retry/backoff):

- `fetchTicker(ticker, range, opts?) → Promise<FetchResult>`
- `fetchTickers(tickers, range, opts?) → Promise<FetchResult[]>`
- `FetchResult = { ok: true, ticker, bars } | { ok: false, ticker, failure: FetchFailure }`
- `FetchFailure = { ticker, reason, message, attempts, status? }` — consumed by
  STORY-051/053. A failed ticker is **never silently dropped**.

## Refreshing fixtures

`fixtures/AAPL.chart.json` is a recorded v8 `chart` response (a null/non-trading
slot is included to exercise row-skipping). To refresh against the live endpoint
during development (outside CI):

```sh
curl -s -A 'Mozilla/5.0' \
  'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&includeAdjustedClose=true&period1=1704153600&period2=1704499200' \
  > tools/yahoo-fetch/fixtures/AAPL.chart.json
```
