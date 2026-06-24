# Screening service (SAD#4.2 / ADR-003)

A Node host for the **same** `src/lib/market.ts` engine that runs in the browser
— no fork. It runs full-universe screens server-side so the client stops
computing thousands of names (SAD#2.5), and exposes a small HTTP/JSON API.

## Run

```sh
node server/index.ts            # listens on :8787 (override with PORT)
```

Node ≥ 23.6 runs the TypeScript sources directly (native type-stripping); no
build step or extra dependency is required. Type-check the service with:

```sh
npx tsc -p server/tsconfig.json
```

## Endpoints

### `GET /health`
Liveness plus the warm universe size: `{ "ok": true, "universe": 44 }`.

### `GET /instrument/:ticker`
One instrument's adjusted OHLCV bars + metadata (SAD#4.3 / SAD#6.1), so the
client can build the Stock locally for the names it displays (detail/compare)
without holding the whole universe in the browser (SAD#4.1 / SAD#2.5). Serving a
single name never triggers a full-universe build. Unknown ticker → `404`.

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
Evaluate the full production universe against a rule set.

Request (`ScreenRequest`):

```jsonc
{
  "preset": "oversold",   // optional: a built-in preset id (engine PRESETS)
  "rules": [ /* Rule[] */ ], // optional: extra rules ANDed onto the preset
  "limit": 500,            // optional: result-page size (default 500)
  "offset": 0              // optional: result-page offset
}
```

Response (`ScreenResponse`):

```jsonc
{
  "total": 12,             // matched names in the full universe
  "count": 12,             // rows in this page
  "offset": 0,
  "limit": 500,
  "elapsedMs": 1.4,        // server-side evaluation time
  "tickers": ["AAPL", ...],// every matched ticker
  "results": [ /* ScreenRow[] */ ]
}
```

### `POST /backtest`
Backtest a screen over the full universe and full available history, server-side
(SAD#2.4 / SAD#3.8). Rank (cross-sectional) rules are excluded from history, as
on the client.

Request (`BacktestRequest`):

```jsonc
{
  "preset": "oversold",      // optional: a built-in preset id (engine PRESETS)
  "rules": [ /* Rule[] */ ]  // optional: extra rules; rank rules are dropped
}
```

Response — **NDJSON stream** (`application/x-ndjson`): zero or more `progress`
lines while the engine runs, then exactly one `result` line carrying the single
summary payload (SAD#6.5) with the SAD#2.7 naive-fidelity `label`:

```jsonc
{ "type": "progress", "name": 22, "total": 44, "pct": 50 }
// …
{ "type": "result", "signals": 1234, "evaluated": 98765, "fireRate": 1.25,
  "horizons": [ { "h": 5, "n": 1234, "avg": 0.4, "median": 0.2,
                  "winRate": 53.1, "best": 18.0, "worst": -12.0 } ],
  "elapsedMs": 210.5, "label": "Demo data for illustrating the workflow — …" }
```

Compute runs server-side so the browser UI thread is never blocked (SAD#2.5);
progress is streamed so a long batch is observable. Pinned by
`server/backtest.test.ts`.

## Design notes

- **Stateless** w.r.t. user identity — no sessions; the shared universe is
  read-only and reused across requests.
- **Warm cache (SAD#2.3).** The universe is built once at boot; the per-Stock
  indicator caches populated during evaluation persist across requests, so the
  warm-cache full-universe screen stays within the p95 ≤ 3 s budget. Pinned by
  `server/screen.test.ts`.
- **Data port (SAD#5.10).** Bars enter only through the `MarketDataProvider`
  port. Until ADR-008 (SAD#8.8) selects a licensed vendor and legal sign-off
  lands (STORY-015), the service uses the synthetic dev/test adapter; the vendor
  adapter drops into `server/universe.ts` without touching handler or engine
  code.

## Out of scope

- Client wiring to this service — STORY-018.
