# Screening service (SAD#4.2 / ADR-003)

A **Fastify** host for the **same** `src/lib/market.ts` engine that runs in the
browser — no fork. It runs full-universe screens server-side so the client stops
computing thousands of names (SAD#2.5), and exposes a small HTTP/JSON API.

This file is written against the handlers as they are. It was rewritten on
2026-09-21 (platform hardening phase 1.3) because it had drifted badly, and
revised the same day for phases 2.1, 2.3 and 4.1, which replaced the hand-rolled
router with Fastify, `console.error` with pino, and the scattered `process.env`
reads with one validated config. Prose drifts; phase 2.2 replaces the endpoint
section below with OpenAPI generated from the route schemas, at which point it
cannot.

## Layout

| File | What lives there |
|---|---|
| `index.ts` | The entry script: warm the universe, listen, install signal handlers. |
| `app.ts` | Builds the Fastify instance — the JSON parser, the error handler, the 404, and which route plugins are registered. |
| `routes/` | One plugin per surface: `system.ts` (`/health`, `/metrics`), `screen.ts` (`/facts`, `/screen`, `/signals`, `/backtest`), `instrument.ts`, `dev.ts`. |
| `handlers.ts` | The transport-agnostic seam: parsed request + warm universe → plain result. |
| `config.ts` | Every environment variable, read and validated once. |
| `logger.ts` | The root pino logger. |
| `shutdown.ts` | The graceful-shutdown sequence and the signal handlers. |
| `universe.ts` | The warm, memoized universe behind the `MarketDataProvider` port. |

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

Every variable is read and validated once, in `config.ts`, at import time. An
invalid one is a boot failure naming the variable — hardening phase 4.1, because
`Number(process.env.PORT) || 8787` used to serve 8787 for `PORT=eight` and a
service on the wrong port looks healthy from the inside.

| Variable | Effect |
|---|---|
| `PORT` | Listen port. Default `8787`. Must be a whole number in 1–65535. |
| `HOST` | Listen address. Default `127.0.0.1` — loopback, so the dev-tools surface is not reachable from the LAN. Set `0.0.0.0` deliberately to expose it. |
| `MARKETDATA_DB` | Path to a SQLite market-data DB (STORY-032). When set it wins over everything else, and an unreadable or wrong-schema file fails the boot rather than silently downgrading to synthetic data. |
| `MARKETDATA_DIR` | Directory the dev DB-selector scans for `.db` files. Default: the repo root. |
| `DEV_TOOLS` | `1` or `true` registers the `/dev/*` surface and honours the persisted dev-dataset pointer. `0`, `false` or unset is off; anything else is refused rather than read as "off". Off in any real deployment. |
| `EOD_DATA_DIR` | Browsable root for the dev import file picker. |
| `LOG_LEVEL` | One of pino's levels, or `silent`. Default `info`. |
| `ANTHROPIC_API_KEY` | Not used yet — hardening stage 3 is the first feature that needs it. If present it must look like an Anthropic key (`sk-ant-…`); the value is never logged and never appears in an error message. |
| `NODE_ENV` | `production` makes the boot fail on purpose: both adapters behind the port are dev/test only (SAD#8.7), and demo data must never back production screening traffic. |

Dataset precedence at boot: `MARKETDATA_DB`, else the `.dev-active-db` pointer
left by a dev import (only when `DEV_TOOLS` is on), else the synthetic generator.

### Logging

pino, one JSON line per event, at `LOG_LEVEL`. Fastify derives a child logger per
request, so every line carries a `reqId` and an "incoming request" line is
followed by a "request completed" line with the status and the duration. A 500
adds a `request failed` line with the error and its stack under the same `reqId` —
a 500 is never silent, which is the one thing the old `sendError` got right and
this had to keep.

Nothing serialises a request or response body, deliberately: pino will happily
write whatever it is handed, and from stage 3 a request body is a screenshot of a
brokerage account.

In development — `NODE_ENV` unset or `development`, which is how `npm run dev`
runs — the same events are rendered through `pino-pretty` instead: a clock time,
the level as a word, and one line per event with `pid`, `hostname` and the
client's address and port dropped, none of which tell you anything when the
process is the terminal you are looking at.

```
[12:56:31.370] INFO: incoming request {"reqId":"req-1","req":{"method":"GET","url":"/health"}}
[12:56:31.374] INFO: request completed {"reqId":"req-1","res":{"statusCode":200},"responseTime":3.37}
```

Anywhere else it is JSON, which is what a log aggregator parses and what phase 4.4
will collect. `pino-pretty` is a devDependency and is not installed in a
production image, so the gate is `nodeEnv === 'development'` rather than
`!== 'production'` — the transport target must never be resolved where the package
is absent, and the test run (`NODE_ENV=test`) does not spawn a transport worker
either.

### Shutdown

`SIGTERM` and `SIGINT` close the listener, give in-flight requests ten seconds to
finish, and then release the provider's handle — `UniverseStore.close()`, which
nothing called before hardening phase 1.2, so the SQLite read handle leaked on
every restart. Idle keep-alive sockets are dropped at once rather than waited
for; whatever is still running when the window expires is cut off, and that path
says so in the log; a second signal exits immediately with a non-zero code.

Fastify's `app.close()` does the first half — it stops the listener, runs the
close hooks and resolves when the server is down — but not the other two, so
`shutdown.ts` still owns the grace window and the idle-socket drop. Fastify's
`forceCloseConnections: 'idle'` option looks like it would cover the latter and
does not: it only calls `closeIdleConnections()` for a server built by a user
`serverFactory`, so switching it on would have been a no-op dressed as a
mechanism. Pinned by `server/shutdown.test.ts`.

## Endpoints

Everything answers JSON except `/backtest`, which streams NDJSON. Every error
leaves in one shape, `{"error": "..."}`:

| Status | When |
|---|---|
| `400` | A `RequestError` from a handler or the strategy parser; a body that is not valid JSON; a path the router cannot decode. |
| `404` | An unknown route (`{"error": "not found"}`) or an unknown ticker. |
| `413` | A request body over the limit: 1 MiB everywhere, 64 MiB on `/dev/import`. |
| `415` | A `POST` whose content type is not `application/json`. |
| `500` | Anything else — flat `{"error": "internal error"}`, with the real cause logged, so a 500 is never silent. |

The service parses `application/json` and nothing else. That is what keeps a
cross-origin form from reaching a state-changing route: `text/plain`,
`application/x-www-form-urlencoded` and `multipart/form-data` are the three
content types a form can send without a preflight, and all three are refused
before a body is read. A `POST` with no body at all is legal — `/screen` has
never read one — and an empty JSON body parses as `{}`.

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
progress is streamed so a long batch is observable — the route hijacks its reply
and writes the raw socket, because Fastify's serialiser would otherwise hold the
whole run and emit it at the end. If the engine throws after the headers are out
the stream simply ends without a `result` line, and the client reports "stream
ended without result". Pinned by `server/fanBacktest.test.ts`.

**These numbers are not yet evidence.** Transaction costs are not modelled and a
per-trade *t* overstates significance; phase 6.2 of
`docs/platform-hardening-plan.md` states the rules any published number must meet.

### Dev-only: `/dev/*` (requires `DEV_TOOLS`)

Registered only when `DEV_TOOLS` is set — with the flag off the plugin does not
exist and these paths fall through to the 404, so the surface cannot exist in a
deployment. Like every other `POST`, the two here answer 415 to anything that is
not `application/json`, before the body is read.

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
  → plain result, with every HTTP detail in `app.ts` and `routes/`. New endpoints
  get a handler first and a route that wraps it. That seam is what let phase 2.1
  swap the whole router for Fastify without touching the engine — `handlers.ts` is
  byte-identical across that change — and it is what phase E of
  `docs/cca-f-learning-plan.md` wraps as MCP tools.
- **The `DEV_TOOLS` gate is structural.** `app.ts` registers the `/dev/*` plugin or
  it does not; with the flag off those paths do not exist. That matters more from
  stage 5 onward, where a second user and a route that hot-swaps the dataset for
  everyone are a bad combination.
- **Data port (SAD#5.10).** Bars enter only through the `MarketDataProvider` port.
  Until ADR-008 (SAD#8.8) selects a licensed vendor and legal sign-off lands
  (STORY-015), the adapters behind it are dev/test only: the SQLite reader when a
  DB is selected, else the synthetic generator. The vendor adapter drops into
  `server/universe.ts` without touching handler or engine code.

## Out of scope

- Authentication and per-user data — hardening stage 5.
- Generated OpenAPI and schema-validated bodies — hardening stage 2.2, which
  retires the hand-written endpoint prose above. Until then the bodies are parsed
  by hand (`parseFanBacktestBody`, `parseFanSignalsBody`, and
  `src/lib/strategy/parse.ts` for a strategy's meaning) and a 400 names the first
  problem it found rather than every field at once.
- A `/ready` probe separate from `/health` — hardening phase 4.4.
