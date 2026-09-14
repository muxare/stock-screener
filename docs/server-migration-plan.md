# Server migration plan — .NET, Python, or a grown-up TypeScript service

Status (2026-09-14): **decided — Option C (stay TypeScript, harden it)**. Mikael chose Option C
on 2026-09-14 and answered §8's open question: the product is *all three* intents at once —
a research platform for trying out trading strategies, a signal source for entries he places
himself at Avanza, and a vehicle for learning deployment/ops plus applying the Anthropic
**CCA-F (Claude Certified Architect – Foundations)** material. The executable work now lives in
**`docs/platform-hardening-plan.md`**; this document is kept as the decision record for *why*
the server stays TypeScript. One thing it got wrong is corrected there: §6 phase 6 treated
server-side persistence as "if and when the product needs it" — the confirmed intents need it,
so it is no longer optional.

The original question this document answered: Mikael asked for a plan to move `server/` to
.NET or Python, and for what "industry standard" would look like if it stayed TypeScript.
It answers all three and recommends one.

**Recommendation up front: keep the server in TypeScript and harden it (Option C).** The
reason is not taste — it is that `server/` is 1,100 lines of glue around 4,114 lines of
indicator math that **the browser also runs**. A port to C# or Python does not move that
engine; it forks it. The rest of this document shows the measurements behind that, then
gives a real, executable plan for each of the three options so the choice is made on
evidence rather than on the word "proper".

---

## 1. What the server actually is today (measured, not assumed)

```
server/*.ts  (non-test)               1,101 lines across 8 modules
server/*.test.ts                        717 lines across 6 suites
src/lib/** reachable from server/     4,114 lines across 19 files   <- the engine
runtime dependencies                        0
HTTP framework                           none (raw node:http, hand-rolled router)
```

The eight server modules:

| Module | Lines | Job |
|---|---:|---|
| `devImport.ts` | 241 | DEV_TOOLS-gated EOD CSV import → builds a SQLite DB |
| `index.ts` | 230 | HTTP server, hand-rolled router, body reader, error mapping |
| `universe.ts` | 182 | Warm memoized `Stock[]`, provider selection, dataset descriptor |
| `devDataset.ts` | 163 | DEV_TOOLS-gated DB selector (list / activate at runtime) |
| `metrics.ts` | 71 | p50/p95/max latency vs. the SAD budgets |
| `handlers.ts` | 65 | Transport-agnostic: universe + config → plain result |
| `fanBacktest.ts` | 56 | Body parsing + `runFanBacktest` passthrough |
| `signals.ts` | 50 | Body parsing + `screenFanSignals` passthrough |
| `screen.ts` | 14 | `screenFan` passthrough |

Nine routes: `/health`, `/facts`, `/metrics`, `/instrument/:ticker`, `POST /screen`,
`POST /signals`, `POST /backtest` (NDJSON stream), plus four `/dev/*` routes behind the
`DEV_TOOLS` flag.

**There is no business logic in `server/`.** `handlers.ts` is 65 lines and every one of them
is shape-juggling. `screen.ts` is a 14-line re-export. The service is a *transport* over
`src/lib`.

### What it is stateless about, and what it isn't

- No auth, no sessions, no users, no cookies, no tokens. Nothing in `server/` reads an
  identity.
- Saved screens and saved strategies live in **`localStorage`** (`src/lib/screen/storage.ts`,
  `src/lib/strategy/storage.ts`). There is no server-side persistence of user data at all.
- The one piece of real state is the warm universe cache in `universe.ts` — built once at
  boot, reused across requests, because the per-`Stock` indicator caches populating during a
  screen are what keep the full-universe screen inside the p95 ≤ 3 s budget.
- Market data is a **read-only** SQLite file (`dev-market.db` 51 MB, `kaggle-market.db`
  94 MB), opened read-only via Node's built-in `node:sqlite`, statements prepared once.

---

## 2. The decisive constraint: the engine is shared with the browser

`server/universe.ts` imports `buildUniverse` from `src/lib/market.ts`. `server/screen.ts`
imports `screenFan` from `src/lib/fan.ts`. `server/fanBacktest.ts` imports `runFanBacktest`
from `src/lib/fanBacktest.ts`.

And so does the client:

```
src/store.ts:343                   const stock = M.buildStock(bars);
src/components/detail/FanDetail.tsx:86-89    ema18: ema(c, 18), ema50: ema(c, 50), …
src/components/modals/FanTradeReview.tsx:101-104   e18: ema(c, 18), e50: ema(c, 50), …
```

This is deliberate and documented. `server/index.ts` opens with it:

> Hosts the **SAME** `src/lib/market.ts` engine server-side (no fork)

`server/README.md` repeats it in its first sentence. It is the stated point of ADR-003.

The consequence for a port is concrete and unavoidable:

> The detail chart draws EMA-18/50/100/200 **in the browser** from `src/lib/indicators.ts`.
> The screen that put a ticker in the table computed those same EMAs **on the server**. If
> the server is C# or Python, those are two independent implementations of a recursive
> float accumulation. They will not agree exactly. The chart will show a fan the screen
> says is not there, at the boundary — which is exactly where a screener's output matters.

Porting therefore means porting **all 4,114 lines** — `indicators.ts`, `fan.ts`,
`fanBacktest.ts` (658 lines of trade simulation), `fanSignals.ts`, the whole
`strategy/` package (1,632 lines: `steps.ts`, `engine.ts`, `primitives.ts`, `trade.ts`,
`parse.ts`, `presets.ts`, `types.ts`), `screen/filters.ts`, `screen/fields.ts`,
`screen/snapshot.ts` — and then keeping the port and the TypeScript original in lockstep
forever, because the browser still needs the TypeScript one to draw charts.

That is not a migration. It is adopting a second codebase and a permanent parity
obligation, in a repo whose *current* open work is a Börsdata ingest plan and phase 4 of
the screener-parity plan.

**Unless** you also move all charting/detail computation to the server (the client stops
computing anything and only renders what it is handed). That is a real design — it is what
Options A and B below assume, and it is priced accordingly. It is a much bigger change
than "migrate the server", and it gives up `SAD#2.5`'s deliberate split.

---

## 3. What "industry standard" is actually missing (and it is not the language)

Grading today's server against what you'd expect from a production service, the gaps are
*orthogonal to the implementation language*. Every one of these is as absent in a fresh
.NET port as it is today, and each must be built regardless of which option is chosen:

| Gap | Today | Notes |
|---|---|---|
| **CI** | none (`.github/workflows` does not exist) | Biggest single gap. Tests and lint are manual. |
| **Graceful shutdown** | `UniverseStore.close()` exists and is **never called** — no `SIGTERM`/`SIGINT` handler in `index.ts` | SQLite handle leaks on every restart |
| **Request validation** | hand-rolled `parseFanBacktestBody`, `parseFanSignalsBody`, `parseStrategyDef` (5 more in `strategy/parse.ts`) | Works, but no schema, so no generated docs and no shared contract |
| **API contract** | prose in `server/README.md`, **and it has drifted** — the README documents `POST /screen` taking `preset`/`rules`/`limit`/`offset` and returning `total`/`count`/`tickers`/`results`; the real handler takes **no body at all** and returns `{universe, elapsedMs, matches, near}` | No OpenAPI, nothing that can go stale silently *and* be caught |
| **Structured logging** | `console.error` with a `[server]` prefix | No request id, no correlation, not machine-parseable |
| **Metrics format** | custom JSON, two hardcoded paths (`screen`, `backtest`) | Not Prometheus/OTel; nothing can scrape it |
| **Containerisation** | none | No Dockerfile, no deploy target |
| **Config** | ad-hoc `process.env` reads scattered across `index.ts`, `universe.ts`, `devImport.ts` | No single validated config surface |
| **Error taxonomy** | `RequestError` → 400, everything else → 500 | Decent foundation, but no 404/409/422 distinction, no error codes |
| **Integration tests** | handlers tested directly; routing/HTTP layer largely untested | No test drives the real `createScreenServer` over the wire |
| **Rate limiting / body limits** | body limits present (1 MiB / 64 MiB), no rate limiting | Fine while loopback-only |

Two things today's server does **better** than a typical rushed Express app, and which any
port must not lose:

1. **The transport-agnostic seam.** `handlers.ts` takes `(universe, config)` and returns a
   plain object. HTTP lives only in `index.ts`. That is the shape most teams refactor
   *toward*.
2. **The `MarketDataProvider` port.** Adapters (`synthetic`, `sqlite`) are selected by
   config in one function. Swapping the data source touches no handler and no engine code.
   The production guard that refuses to serve a dev adapter under `NODE_ENV=production` is
   better discipline than most services ship with.

---

## 4. Option A — .NET (ASP.NET Core, C#)

### What it would look like

```
server-dotnet/
  Screener.Api/            Minimal API endpoints, DI, Serilog, health checks
  Screener.Engine/         PORT of src/lib: indicators, fan, strategy, backtest
  Screener.Data/           Microsoft.Data.Sqlite provider + universe cache
  Screener.Engine.Tests/   xUnit + golden-vector parity suite vs. the TS engine
```

- **Framework:** ASP.NET Core Minimal APIs. `MapGet("/health")`, `MapPost("/screen")`.
- **Validation:** FluentValidation or source-generated `System.Text.Json` contracts.
- **Docs:** Swashbuckle/OpenAPI generated from the endpoint signatures — genuinely first-class.
- **Streaming `/backtest`:** `IAsyncEnumerable<T>` + `Results.Stream`, or write NDJSON to
  `HttpResponse.BodyWriter` directly. Straightforward.
- **SQLite:** `Microsoft.Data.Sqlite`, read-only connection string, prepared commands.
- **Warm universe:** a singleton service holding the built `Stock[]`. Natural fit for DI.
- **Metrics:** `System.Diagnostics.Metrics` → OpenTelemetry → Prometheus. Best-in-class.
- **Hosting:** self-contained `dotnet publish`, small container, real `IHostApplicationLifetime`
  shutdown hooks (fixes the `close()` gap properly).

### Phases

- **Phase 0 — Golden vectors.** Before writing any C#, export a fixture set from the TS
  engine: for N tickers, every indicator series, every `screenFan` row, every
  `runFanBacktest` summary, serialised to JSON with full float precision. This is the
  parity harness and it is the *only* thing that makes the port verifiable.
  Touch scope: `tools/export-vectors/` (new), `docs/`.
- **Phase 1 — `Screener.Engine`: indicators + market model.** Port `indicators.ts` (110),
  `market.ts` (183). Make phase 0's indicator vectors pass, including the float-equality
  tolerance decision (this is where you discover whether exact parity is achievable or
  whether you are accepting an epsilon — **decide and document it here**; an epsilon means
  the chart and the screen can legitimately disagree at the boundary).
- **Phase 2 — `Screener.Engine`: fan + screen.** Port `fan.ts` (283),
  `screen/fields.ts` (182), `screen/filters.ts` (345), `screen/snapshot.ts` (123),
  `screen/format.ts` (53). Phase 0's screen-row vectors pass.
- **Phase 3 — `Screener.Engine`: the strategy package.** Port `strategy/types.ts`,
  `primitives.ts`, `steps.ts` (520), `engine.ts` (354), `trade.ts`, `parse.ts`,
  `presets.ts` — 1,632 lines, the hardest and least mechanical part.
- **Phase 4 — `Screener.Engine`: backtest + signals.** Port `fanBacktest.ts` (658) and
  `fanSignals.ts` (201). Backtest summary vectors pass.
- **Phase 5 — `Screener.Data`.** SQLite adapter against the existing schema (unchanged —
  the DB files are the contract), synthetic adapter, warm universe singleton.
- **Phase 6 — `Screener.Api`.** The nine routes, NDJSON streaming, error mapping, OpenAPI,
  Serilog, OTel metrics, graceful shutdown, Dockerfile.
- **Phase 7 — Cutover.** Point the Vite proxy at the .NET service. Run both in parallel
  against the same DB and diff responses for a period before deleting `server/`.
- **Phase 8 — The dev-tools surface.** Port `devImport.ts` (241) and `devDataset.ts` (163),
  *or* consciously keep them as Node scripts outside the service. Note the CSV importer
  also underpins `tools/eod-import` and the in-flight Börsdata plan.

### Honest cost

Phases 1–4 are **~3,000 lines of numerically-sensitive financial math** ported by hand,
with a parity bar. Phases 5–8 are another ~1,100. And at the end, `src/lib` still exists and
is still shipped to the browser — **unless** you additionally rewrite the client to stop
computing (`FanDetail.tsx`, `FanTradeReview.tsx`, `store.ts:343`) and add server endpoints
to feed the chart what it currently derives. That client rework is not costed above.

### When this is the right call

If the destination is a multi-user product with accounts, server-side saved screens, a
scheduled nightly screen-and-alert job, and a team that is strongest in C#. .NET's
concurrency story, OTel integration, and hosting model are genuinely better than Node's for
that, and the numeric work (`double`, `Span<T>`) is faster than JS. But that is a *product*
decision that would justify the port — the port does not create it.

---

## 5. Option B — Python (FastAPI)

### What it would look like

```
server_py/
  app/main.py              FastAPI app, lifespan, routers
  app/api/                 routes: health, facts, metrics, instrument, screen, signals, backtest
  app/engine/              PORT of src/lib — as NumPy/pandas, not line-by-line
  app/data/                sqlite3 read-only provider, universe cache
  tests/                   pytest + the same golden-vector parity suite
```

- **Framework:** FastAPI. Pydantic v2 models give you validation **and** OpenAPI from one
  declaration — the single strongest argument for this option.
- **Streaming `/backtest`:** `StreamingResponse` over a generator. Clean.
- **SQLite:** stdlib `sqlite3`, `file:…?mode=ro` URI.
- **Warm universe:** built in the `lifespan` handler, held on `app.state`.
- **The real draw: the engine becomes vectorised.** `ema`, the fan test, and the screen
  sweep are natural NumPy/pandas operations. A full-universe screen that is a loop over
  `Stock[]` in JS becomes array math. This is the one option where the port could make the
  service *materially faster*, not just differently-shaped.
- **The real risk: the same rewrite destroys line-by-line parity.** Vectorising is a
  reimplementation, not a translation — and `fanBacktest.ts` is a sequential,
  path-dependent trade simulation (entry, stop, trailing, exit) that vectorises badly.
  Expect phases 3–4 to be loop-for-loop Python, which will be **slower** than the Node
  original, not faster.

### Phases

Same shape as Option A — phase 0 golden vectors first, then indicators → fan/screen →
strategy → backtest/signals → data → API → cutover → dev tools — with one addition:

- **Phase 2b — Vectorisation decision.** After the indicator and screen ports pass parity,
  decide explicitly which modules stay scalar (for parity) and which go NumPy (for speed),
  and record the tolerance for each. Do not leave this implicit.

### Honest cost

Same ~3,000 lines of math. Plus: a second toolchain (uv/poetry, ruff, mypy, pytest) in a
repo that currently has exactly one (`npm`); a second CI matrix; and type safety that is
opt-in rather than enforced. The repo already has "TS + Python tooling" in `tools/`, so
Python is not foreign here — but `tools/` scripts are batch importers, a very different
reliability bar from the request path.

### When this is the right call

If the roadmap is heading toward research/quant work — walk-forward optimisation, parameter
sweeps, ML-ranked signals, notebook-driven exploration of backtest output. Then the
ecosystem (pandas, scipy, statsmodels, scikit-learn) is worth the fork, because you'd be
pulling that work into Python *anyway* and the engine should live where the research lives.
Note the Börsdata plan's fundamentals/KPI work leans this way.

---

## 6. Option C — Stay TypeScript, make it industry standard (recommended)

This closes every gap in §3 without forking the engine, without a parity obligation, and
without touching `src/lib` at all. It is roughly **one to two weeks of work** against the
several months Options A and B imply.

### Phase 1 — CI and the correctness floor
*The largest real gap, and it is not about the server at all.*

- `.github/workflows/ci.yml`: `npm ci` → `npm run typecheck` → `npm run lint` →
  `npm run test` on push and PR. Node 24 matrix.
- Coverage reporting on `server/` and `src/lib/`.
- **Fix graceful shutdown**: wire `SIGTERM`/`SIGINT` in `index.ts` to
  `server.close()` + `productionUniverse.close()`. The `close()` method already exists and
  is dead code today.
- **Fix the README drift**: `server/README.md`'s `POST /screen` section describes an API
  that does not exist. Rewrite against the real handlers (phase 3 then replaces prose with
  generated OpenAPI).

Touch scope: `.github/`, `server/index.ts`, `server/README.md`.
Verify: CI green on a PR; `kill -TERM` on the dev server closes the SQLite handle cleanly.

### Phase 2 — A real HTTP framework
*Replace the hand-rolled router, body reader, and error mapper with a maintained one.*

- Adopt **Fastify** (mature, fastest Node framework, first-class TypeScript, plugin
  ecosystem, built-in pino logging and schema validation) — or **Hono** if you want
  edge/runtime portability. Fastify is the safer call for a data-heavy service.
- Routes become plugins: `routes/screen.ts`, `routes/instrument.ts`, `routes/dev.ts`
  (registered only when `DEV_TOOLS` is on — the gate becomes structural rather than an
  `if` inside the router).
- Delete: the hand-rolled `readJsonBody`, `sendJson`, `sendError`, `requireJson` and the
  `url.startsWith` routing. Keep `RequestError` as the 400 signal, mapped by a Fastify
  error handler.
- `/backtest` keeps its NDJSON streaming — `reply.raw` or `reply.send(stream)`.
- **`handlers.ts` does not change.** That seam is already right; this phase only swaps what
  calls it.

Touch scope: `server/index.ts` → `server/app.ts` + `server/routes/*`, `package.json`.
Verify: all existing server tests pass unchanged; add `supertest`-style integration tests
that drive the real app over HTTP — the layer with no coverage today.

### Phase 3 — Schemas at the boundary, OpenAPI out of them

- Introduce **Zod** (or TypeBox, which Fastify consumes natively) and define
  `ScreenRequest`, `SignalsRequest`, `BacktestRequest`, and every response shape once.
- Replace `parseFanBacktestBody` / `parseFanSignalsBody` with schema `.parse()`. Keep the
  richer domain parsing in `src/lib/strategy/parse.ts` behind the schema — the schema
  validates *shape*, `parse.ts` validates *meaning*.
- Generate **OpenAPI** via `@fastify/swagger` and serve it. The README's API section is then
  generated, and cannot drift again.
- Optionally emit a typed client for `src/lib/client/marketClient.ts` from the same schemas,
  so a route change breaks the client at compile time.

Touch scope: `server/schemas/` (new), `server/routes/*`, `server/fanBacktest.ts`,
`server/signals.ts`, `src/lib/client/marketClient.ts`.
Verify: malformed bodies return 400 with field-level detail; `/docs` renders; a deliberate
response-shape change fails `npm run typecheck` in the client.

### Phase 4 — Observability

- **pino** structured JSON logs with a per-request id, replacing `console.error`. Fastify
  ships this.
- Extend `metrics.ts` to expose **Prometheus** text format alongside the existing JSON
  snapshot (keep the JSON — tests assert on it and the budget checks are good).
- Widen `MetricPath` beyond the two hardcoded values, or derive it from the route table.
- Optional: OpenTelemetry traces, which is where Node has closed most of the gap to .NET.

Touch scope: `server/metrics.ts`, `server/app.ts`.
Verify: `/metrics` scrapes; a request id ties a 500 log line to the response.

### Phase 5 — Config and deployment

- One `server/config.ts` that reads and **validates** every env var at boot (`PORT`, `HOST`,
  `DEV_TOOLS`, `MARKETDATA_DB`, `NODE_ENV`) and fails fast with a clear message —
  consolidating the reads currently scattered across three modules. The existing
  production-guard in `universe.ts` moves here and gets tested in one place.
- **Dockerfile** (multi-stage, non-root, the DB mounted as a read-only volume) +
  `docker-compose.yml` for local parity.
- Split `/health` (liveness) from `/ready` (universe built, provider open) — the current
  `/health` builds the universe to report its size, which is a liveness check doing
  readiness work.

Touch scope: `server/config.ts` (new), `server/universe.ts`, `Dockerfile`, `compose.yml`.
Verify: container boots against a mounted `dev-market.db`; missing/invalid env fails fast.

### Phase 6 — Persistence, *if and when the product needs it*

This is the phase that would actually justify calling the result a "proper backend", and
notably **none of §3's gaps require it**. Today saved screens and strategies are
`localStorage`. If they should be multi-device or multi-user:

- A second SQLite (or Postgres) database for **user** data, kept strictly separate from the
  read-only market DB. Use a migration tool (Drizzle/Kysely + migrations) — note the
  Börsdata plan already flags "there is no migration mechanism" as a problem.
- `POST/GET/DELETE /screens`, `/strategies` behind auth.
- Auth: OIDC via an identity provider rather than hand-rolled sessions.
- `src/lib/screen/storage.ts` already injects its storage backend and tolerates a `null`
  one — swapping `localStorage` for an HTTP-backed implementation is a contained change,
  which is a genuine piece of foresight in the existing design.

**This phase is language-independent.** It is the one thing that would make a "real server"
real, and it is equally available in TypeScript.

---

## 7. Recommendation

| | .NET | Python | TypeScript (Option C) |
|---|---|---|---|
| Engine code ported by hand | ~3,000 lines | ~3,000 lines | **0** |
| Permanent TS↔port parity obligation | yes | yes | **no** |
| Client rework required to avoid fork | yes | yes | **no** |
| Closes the §3 gaps | yes, after the port | yes, after the port | **yes, directly** |
| Toolchains in the repo | 2 | 2 | **1** |
| Rough effort | months | months | **1–2 weeks** |
| Raw numeric throughput | best | mixed (vectorised fast / sequential slow) | adequate today |
| Fits current roadmap (Börsdata, parity phase 4) | blocks it | blocks it | **parallel to it** |

**Do Option C.** Phases 1–5 give a service that is genuinely industry standard — CI,
framework, schema validation, OpenAPI, structured logs, Prometheus, container, validated
config, clean shutdown — while `src/lib` stays the single engine both the browser and the
server run. Phase 6 is where you go when the product needs accounts.

**Revisit .NET or Python only when a product requirement — not an aesthetic one — demands
it.** The two that genuinely would:

- **Quant/research roadmap** (walk-forward optimisation, parameter sweeps, ML ranking, and
  the Börsdata fundamentals/KPI work heading toward notebooks) → **Python**, and accept the
  fork deliberately, probably as a *separate research service* alongside the TS screener
  rather than a replacement for it.
- **Multi-tenant SaaS with heavy concurrent server-side compute** → **.NET**, and budget the
  client rework in the same breath.

In both cases the honest framing is "add a second service for a job the current one cannot
do", not "migrate the server". A migration justified only by the language is, here, a
several-month project whose main deliverable is a second copy of `indicators.ts`.

## 8. Open question for the decision gate

Before any of this starts: **what is the product intent?** The plan above branches entirely
on it, and nothing in the repo answers it.

- Single-user local tool (what it is today) → Option C phases 1–5, stop.
- Multi-user hosted product → Option C phases 1–6, still TypeScript.
- Research/quant platform → Option C phases 1–5 **plus** a separate Python research service
  that reads the same SQLite datasets.
