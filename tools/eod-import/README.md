# EOD CSV → SQLite importer (STORY-031)

Dev/test tooling that ingests end-of-day OHLCV CSV files into a SQLite database
so development and testing can run against real-shaped historical data instead of
the synthetic generator (`src/lib/data/synthetic.ts`).

The read side — a `sqliteProvider` behind the `MarketDataProvider` port — is
STORY-032. This tool only **writes** the DB.

## Scope & assumptions (binding)

- **Dev/test only** (SAD#1.2 / SAD#8.7 / ADR-007). This is **not** a production
  ingestion path: no vendor SDK, no network fetch, no scraping. It ingests CSV
  files already on disk.
- **Bars are trusted as pre-adjusted.** This tool performs **no** corporate-action
  (split/dividend) adjustment — that stays with the licensed-vendor adapter
  (SAD#2.2 / ADR-005 / STORY-015). Feed it data that is already adjusted.
- Schema is the SAD#6.1 model and is **read-only** to the rest of the system
  (SAD#4.3): the importer is the only writer.

## Usage

```sh
node tools/eod-import/index.ts --config <config.json> --out <db path> <csv|dir> [...]
# or via the npm script:
npm run eod:import -- --config tools/eod-import/config.example.json --out dev.db data/
```

Inputs may be individual `.csv` files or directories (each directory contributes
its immediate `.csv` files). Re-running on the same input is **idempotent** —
bars upsert on `(ticker, date)`, instruments on `ticker`.

## Schema (SAD#6.1)

```sql
instrument(ticker PRIMARY KEY, name, sector)
bar(ticker, date, o, h, l, c, v, PRIMARY KEY (ticker, date))
```

`date` is stored as ISO `YYYY-MM-DD` so it orders chronologically by lexical sort
(STORY-032 returns bars in date order; the engine `Bar` shape itself carries no
date — SAD#6.1).

## Config

A JSON file describes how to read a source — onboard a new source (Stooq, Yahoo,
a broker export) by editing config, **never** code. See `config.example.json`.

| Field | Meaning |
| --- | --- |
| `columns.{date,open,high,low,close,volume}` | **Required.** Source column names. |
| `columns.{ticker,name,sector}` | Optional. Ticker falls back to the filename; name to the ticker; sector to metadata then `'Unknown'`. |
| `dateFormat` | `iso` \| `yyyymmdd` \| `mm/dd/yyyy` \| `dd/mm/yyyy`. |
| `ticker.case` | `upper` (default) \| `lower` \| `none`. |
| `ticker.stripSuffix` | Drop a trailing exchange suffix, e.g. `.US` for Stooq. |
| `delimiter` | Field delimiter (default `,`). |
| `metadataFile` | Optional `{ "<TICKER>": { name?, sector? } }`, relative to the config file. |

## Layouts supported

- **One file, many tickers** — ticker comes from the mapped `ticker` column.
- **One file per ticker** — when there is no ticker column (or the cell is
  blank), the ticker is the filename stem (normalized like any other ticker).

## Error handling

Malformed or blank rows are **reported** (count + a small sample) and **skipped**;
one bad row never aborts the run. The CLI prints the skipped count and up to 10
example rows.

## Note

`node:sqlite` is used (Node's built-in synchronous SQLite — no third-party
dependency, and synchronous to match STORY-032's read adapter). Node prints an
`ExperimentalWarning` for it; that is expected for this dev/test tool.
