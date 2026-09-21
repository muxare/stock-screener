# Screening service (SAD#4.2 / ADR-003)

A Node host for the **same** `src/lib/market.ts` engine that runs in the browser
— no fork. It runs full-universe screens server-side so the client stops
computing thousands of names (SAD#2.5), and exposes a small HTTP/JSON API.

This file is written against the handlers as they are. It was rewritten on
2026-09-21 (platform hardening phase 1.3) because it had drifted badly: it
documented a `POST /screen` taking `preset` / `rules` / `limit` / `offset` and
returning `total` / `count` / `tickers` / `results`, none of which the service has
ever accepted or returned, and it described none of `/facts`, `/metrics`,
`/signals` or the dev surface. Prose drifts; stage 2 replaces this section with
OpenAPI generated from the route schemas, at which point it cannot.

## Run

```sh
node server/index.ts            # listens on 127.0.0.1:8787
npm run dev:server              # the same, under --watch and with DEV_TOOLS=1
```

Node ≥ 24.2 (the `engines` floor) runs the TypeScript sources directly via native
type-stripping; no build step or extra dependency is required. Type-check the service with:

```sh
npx tsc -p server/tsconfig.json   # or `npm run typecheck` for the whole repo
```

### Environment

| Variable | Effect |
|---|---|
| `PORT` | Listen port. Default `8787`. |
| `HOST` | Listen address. Default `127.0.0.1` — loopback, so the dev-tools surface is not reachable from the LAN. Set `0.0.0.0` deliberately to expose it. |
| `MARKETDATA_DB` | Path to a SQLite market-data DB (STORY-032). When set it wins over everything else, and an unreadable or wrong-schema file fails the boot rather than silently downgrading to synthetic data. |
| `MARKETDATA_DIR` | Directory the dev DB-selector scans for `.db` files. Default: the repo root. |
| `DEV_TOOLS` | `1` or `true` registers the `/dev/*` surface and honours the persisted dev-dataset pointer. Off in any real deployment. |
| `EOD_DATA_DIR` | Browsable root for the dev import file picker. |
| `NODE_ENV` | `production` makes the boot fail on purpose: both adapters behind the port are dev/test only (SAD#8.7), and demo data must never back production screening traffic. |

Dataset precedence at boot: `MARKETDATA_DB`, else the `.dev-active-db` pointer
left by a dev import (only when `DEV_TOOLS` is on), else the synthetic generator.

### Shutdown

`SIGTERM` and `SIGINT` close the listener, give in-flight requests ten seconds to
finish, and then release the provider's handle — `UniverseStore.close()`, which
nothing called before hardening phase 1.2, so the SQLite read handle leaked on
every restart. Idle keep-alive sockets are dropped at once rather than waited
for; a second signal exits immediately with a non-zero code. Pinned by
`server/index.test.ts`.

## Endpoints

Everything answers JSON except `/backtest`, which streams NDJSON. Bad input is
`400 {"error": "..."}` (a `RequestError` from the handler or the strategy parser),
an unknown route is `404 {"error": "not found"}`, and anything else is
`500 {"error": "internal error"}` with the real cause logged, so a 500 is never
silent. Request bodies are capped at 1 MiB, and at 64 MiB on `/dev/import`.

### `GET /health`
Liveness plus the warm universe size. Note that reporting the size builds the
universe, so this is a liveness probe doing readiness work; hardening phase 4.4
splits it into `/health` and `/ready`.

```jsonc
{ "ok": true, "universe": 44 }
```

Every example in this file is a real response from the synthetic dataset, which is
44 names; against an imported DB the counts are whatever that DB holds.

### `GET /facts`
Universe count and sector facets only (STORY-028), so the bootstrap can render
the "of N" total and the sector filter without pulling per-name rows.

```jsonc
{ "total": 44, "sectors": ["Communication", "Consumer Disc.", "…"], "sample": "AAPL" }
```

### `GET /metrics`
Latency snapshot (STORY-021): per path, the sample count, p50 / p95 / max, the
SAD budget and how many samples exceeded it. Recorded for `screen` (p95 ≤ 3 s,
SAD#2.3) and `backtest` (≤ 30 s, SAD#2.4).

```jsonc
{
  "screen":   { "path": "screen",   "count": 3, "p50": 41.2, "p95": 58.0,
                "max": 58.0, "budgetMs": 3000,  "overBudget": 0 },
  "backtest": { "path": "backtest", "count": 0, "p50": 0, "p95": 0,
                "max": 0, "budgetMs": 30000, "overBudget": 0 }
}
```

### `GET /instrument/:ticker`
One instrument's adjusted OHLCV bars + metadata (SAD#4.3 / SAD#6.1), so the
client can build the Stock locally for the names it displays (detail/compare)
without holding the whole universe in the browser (SAD#4.1 / SAD#2.5). Serving a
single name never triggers a full-universe build. Unknown ticker → `404`; a
malformed percent-encoding → `400`.

Response (`InstrumentBars`):

```jsonc
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "sector": "Technology",
  "bars": [ { "o": 191.2, "h": 193.4, "l": 190.1, "c": 192.8, "v": 4210000 } /* … */ ]
}
```

### `POST /screen`
Classify the whole warm universe by the EMA fan (`src/lib/fan.ts`): `matches` are
the names in a full 18 > 50 > 100 > 200 stack, `near` the ones entering it. **The
body is ignored** — there is no rule set, preset, or paging here. A screen with
filters is the client's job over these rows; the server-side rule engine the old
version of this file described was never built.

Response (`ScreenResponse`):

```jsonc
{
  "universe": 44,        // names classified
  "elapsedMs": 41.2,     // server-side evaluation time (recorded in /metrics)
  "matches": [ /* FanRow[] */ ],
  "near":    [ /* FanRow[] */ ]
}
```

A `FanRow` carries `ticker`, `name`, `sector`, `price`, `changePct`, the four EMA
values, `ema200Ago` (the 200-EMA 21 / 63 / 105 bars back, `null` where history is
short), `worstGap`, `sparkline`, `avgVol20`, `relVol`, `marketCap` and a last-bar
indicator `snapshot`. The shape is `FanRow` in `src/lib/fan.ts`.

### `POST /signals`
The live "current entry" screen for one strategy: the names with an open trade on
the latest bar, with entry, stop, R and target-window numbers.

Request:

```jsonc
{
  "strategy": "onset",       // required: a preset id or a full StrategyDef object
  "minAvgVol": 0,            // optional liquidity floor (20-day average volume)
  "minMarketCap": 0,         // optional market-cap floor
  "ema200RisingBars": 21     // optional trend filter; 0 disables it
}
```

A missing or empty `strategy` is `400 {"error": "unknown or missing strategy"}`;
an unknown id is `400 {"error": "unknown strategy \"…\""}`. The preset ids are
`onset`, `cross`, `tag18`, `tag50`, `structure`, `dual_ema`, `bunn_bounce` and
`bunn_cont` (`src/lib/strategy/presets.ts`).

Response (`SignalsResponse`):

```jsonc
{
  "universe": 44,
  "elapsedMs": 12.7,
  "strategy": "onset",
  "strategyName": "Fan onset (baseline)",
  "rows": [ /* FanSignalRow[] */ ]
}
```

A `FanSignalRow` adds `entryDate`, `barsAgo`, `entryPrice`, `stopPrice`,
`riskPerShare`, `riskPct`, `targetLoR` / `targetHiR` and their prices, and `openR`
(mark-to-market R at the latest close) to the display fields a `FanRow` carries.

### `POST /backtest`
Backtest a fan strategy over the full universe and full available history,
server-side (SAD#2.4 / SAD#3.8).

Request — every field is optional and falls back to
`DEFAULT_FAN_BACKTEST_CONFIG`:

```jsonc
{
  "strategy": "onset",       // preset id or StrategyDef; default preset if absent
  "horizons": [5, 10, 21],   // forward-return horizons in bars
  "minAvgVol": 0,
  "minMarketCap": 0,
  "ema200RisingBars": 21,
  "startCash": 10000,        // the cash book below; > 0
  "riskPct": 1,              // percent of equity risked per trade, capped at 100
  "maxPositions": 4,         // concurrent positions, capped at 50
  "windowMonths": 3          // cash-book window; 0 means all history
}
```

Response — **NDJSON stream** (`application/x-ndjson`): one `progress` line per
name scanned, then exactly one `result` line.

```jsonc
{ "type": "progress", "name": 1, "total": 44 }
// …
{ "type": "result", "elapsedMs": 210.5,
  "config": { /* the resolved FanBacktestConfig, echoed back */ },
  "universe": 44, "stocksScanned": 44, "totalEntries": 9, "stocksWithEntries": 7,
  "forwardHorizons": [ { "h": 5, "n": 8, "avg": 1.88, "median": 0.48,
                         "winRate": 75, "best": 7.94, "worst": -2.34 } ],
  "trades":  { "count": 9, "winRate": 33.3, "avgReturnPct": 1.53, "medianReturnPct": 0,
               "avgR": 0.73, "medianR": 0, "hitTargetPct": 0, "avgBarsHeld": 12.9,
               "byExitReason": { "breakeven": 4, "end_of_data": 4, "stop_r": 1 } },
  "entries": [ /* FanEntryEvent[] — one per fill, with the rule that fired */ ],
  "factors": [ { "factor": "MACD hist", "bucket": "> 0", "n": 8,
                 "winRate": 37.5, "avgR": 0.82 } ],
  "account": { "startCash": 10000, "endEquity": 10642.43, "returnPct": 6.42,
               "maxDrawdownPct": 1.0, "taken": 7,
               "skipped": { "total": 2, "noCash": 0, "maxPositions": 2 },
               "endReason": "window", "windowStart": "2026-03-19",
               "windowEnd": "2026-06-19", "candidates": 9, "curve": [ /* … */ ] } }
```

Compute runs server-side so the browser UI thread is never blocked (SAD#2.5), and
progress is streamed so a long batch is observable. If the engine throws after the
headers are out the stream simply ends without a `result` line, and the client
reports "stream ended without result". Pinned by `server/fanBacktest.test.ts`.

**These numbers are not yet evidence.** Transaction costs are not modelled and a
per-trade *t* overstates significance; phase 6.2 of
`docs/platform-hardening-plan.md` states the rules any published number must meet.

### Dev-only: `/dev/*` (requires `DEV_TOOLS`)

Registered only when `DEV_TOOLS` is set — with the flag off these paths fall
through to the 404, so the surface cannot exist in a deployment. The two `POST`
routes require `content-type: application/json` and reject anything else before
reading the body, which is what keeps a cross-origin form from reaching them.

- `GET /dev/import/options` — the configs, the browsable data root and its
  immediate CSV files and subdirectories, and the target DB (`ImportOptions`).
- `POST /dev/import` — build a SQLite DB from EOD CSVs (STORY-031) and hot-swap
  the running service onto it. Body: `configName`, optional inline `configJson`,
  and either `inputPath` or uploaded `uploads`; optional `targetDb`. Returns file
  / instrument / bar counts, per-line errors and the new warm-universe size.
- `GET /dev/databases` — the `.db` files found in the scan directory, each with
  its size, instrument count, whether it is a readable market-data DB, and
  whether it is the active one (STORY-035).
- `POST /dev/databases/activate` — switch datasets at runtime with no restart:
  `{ "path": "/abs/path.db" }` or `{ "synthetic": true }`. The choice is persisted
  to `.dev-active-db` so it survives the next `--watch` restart.

## Design notes

- **Stateless** w.r.t. user identity — no sessions; the shared universe is
  read-only and reused across requests.
- **Warm cache (SAD#2.3).** The universe is built once at boot; the per-Stock
  indicator caches populated during evaluation persist across requests, so the
  warm-cache full-universe screen stays within the p95 ≤ 3 s budget. Pinned by
  `server/screen.test.ts`.
- **`handlers.ts` is the transport-agnostic seam.** Parsed request + warm universe
  → plain result, with every HTTP detail in `index.ts`. New endpoints get a
  handler first and a route that wraps it — that seam is what lets stage 2 swap
  the router for Fastify without touching the engine, and what phase E of
  `docs/cca-f-learning-plan.md` wraps as MCP tools.
- **Data port (SAD#5.10).** Bars enter only through the `MarketDataProvider` port.
  Until ADR-008 (SAD#8.8) selects a licensed vendor and legal sign-off lands
  (STORY-015), the adapters behind it are dev/test only: the SQLite reader when a
  DB is selected, else the synthetic generator. The vendor adapter drops into
  `server/universe.ts` without touching handler or engine code.

## Out of scope

- Authentication and per-user data — hardening stage 5.
- Generated OpenAPI and schema-validated bodies — hardening stage 2.2, which
  retires the hand-written endpoint prose above.
