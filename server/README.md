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

- Backtest endpoint — STORY-017.
- Client wiring to this service — STORY-018.
