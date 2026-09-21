# Platform hardening plan — from dev tool to research + signal platform

Status (2026-09-21): **in progress — stage 1 complete (1.1, 1.2, 1.3 landed); stage 2 under way
(2.1 and 2.3 landed, 2.2 open); 4.1 landed early, on the 2.1 branch**. Follows the
Option C decision recorded in `docs/server-migration-plan.md`: the server stays TypeScript and gets hardened rather than
ported. This document is the executable half. The CCA-F track (stages 3 and 7 here) is
expanded, with the Claude Code, MCP and Agent SDK gaps filled, in `docs/cca-f-learning-plan.md`.

## The three intents, and what each one demands

Mikael confirmed the product is all three of these at once. They are not in conflict, but
they pull on different parts of the system, and the phases below are ordered so that each
one unblocks the next rather than being done in parallel by one person.

| Intent | What it actually demands |
|---|---|
| **Research platform** — try out trading strategies | Backtest runs must be **durable, reproducible and comparable**. Today a run is an ephemeral NDJSON stream that is rendered once and lost. A research platform needs the run, its config, and *the exact data it ran against* recorded together — and it needs to be **statistically honest about what it found**, which phase 6.2 shows is the harder half. |
| **Trading platform** — entries to consider at Avanza | A **scheduled** post-close pipeline and an **immutable signal log**. What matters is not just today's signals but what the system said last Tuesday and what data it said it from. Plus Nordic coverage, which is the in-flight `docs/borsdata-ingest-plan.md`. |
| **Learning platform** — deploy/manage it, apply CCA-F | Infrastructure stops being overhead and becomes a **deliverable**. Containers, CI/CD, observability, secrets and a local→cloud path are the point, not a tax. And the Anthropic **Claude Certified Architect – Foundations** material gets applied to real features here, not toy ones. |

### Decisions taken (2026-09-14) — do not re-open

- **Deployment: local first, cloud later.** Build for containers now, run on your own
  hardware, treat the cloud move as a distinct later stage.
- **Avanza: advisory + read-only portfolio sync. No order execution.** Signals are entries
  *to consider*; you place them yourself. Portfolio sync is either typed in by hand or read
  by Claude from a screenshot of the Avanza account.
- **Notification: in the UI only.** No email, no push, no external channel. The signal log is
  the source of truth and the UI reads it — so the nightly pipeline needs no outbound
  dependency and no third secret.
- **History: as much as the provider will give.** Börsdata's full available history, not a
  convenient window. A 2-year window was considered on 2026-09-14 and **rejected on measured
  evidence** — see phase 6.2, which shows the effective sample size is driven by elapsed time
  and not by universe breadth, so a short window cannot be compensated for with more tickers.
  Storage is not the binding constraint; the memory consequence is handled in stage 6.4.
- **Multiple users: build for it.** Not "leave a seam" — the auth and per-user data story is
  a deliberate learning goal, so stage 5 carries it properly rather than deferring it.

### One design invariant that falls out of that

> **The system never places an order and never holds a broker credential that could.**

This is worth stating explicitly because it is what keeps the reliability bar sane. An
advisory system that is wrong costs you a bad trade you chose to take. An execution system
that is wrong costs you money while you sleep, and needs idempotency, reconciliation, kill
switches and a regulatory conversation. Everything below is scoped to the first.

---

## Stage 1 — The correctness floor *(Track: service)*

Small, no design decisions, unblocks everything. Do this first.

**Phase 1.1 — CI. Landed 2026-09-14.** `.github/workflows/ci.yml`: `npm ci` →
`npm run typecheck` → `npm run lint` → `npm run test` on push and PR, on a **Node 24 + 25**
matrix rather than 24 alone — 24 is the `engines` floor, 25 is what development happens on.
This was the single biggest gap in the repo — `.github/workflows` did not exist, so tests and
lint were manual.

**Phase 1.2 — Graceful shutdown. Landed 2026-09-21.** `UniverseStore.close()` exists and is
**never called**; there is no `SIGTERM`/`SIGINT` handler in `server/index.ts`, so the SQLite
handle leaks on every restart. Wire signals to `server.close()` +
`productionUniverse.close()`. This matters more than it looks: everything from stage 4 onward
runs in a container, where `SIGTERM` is how the process is asked to stop.

*Two things the text above did not account for.* `server.close()` alone is not enough to
end the process: it waits for every open connection, and the Vite dev proxy holds an idle
keep-alive socket open indefinitely, so a shutdown built from `close()` and nothing else
would hang until the socket happened to time out. The implementation therefore closes idle
connections immediately and cuts whatever is still running after a ten-second grace window,
which also bounds the shutdown for `docker stop`, whose own default patience is ten seconds
before SIGKILL. And the ordering is a decision rather than an accident: the listener stops
first, in-flight requests get the window, and the provider closes last, so a `/backtest`
still streaming bars is not reading from a database that has already been closed.

*What phase 2.1 did to this, on 2026-09-21.* The code moved to `server/shutdown.ts` and the
tests to `server/shutdown.test.ts`; every guarantee above is still asserted, over Fastify's
promise-returning `app.close()` instead of `http.Server.close(cb)`. Fastify takes over the
first half — it stops the listener, runs its close hooks and resolves when the server is
down — so there is no callback left to wrap. The grace window and the forced cut are still
ours. So is dropping idle sockets, and the reason is worth recording because it looks like it
should not be: Fastify's `forceCloseConnections: 'idle'` appears to be the native replacement
for the explicit `closeIdleConnections()` call, but it only fires for a server built by a user
`serverFactory`, so setting it here would have been a no-op wearing the costume of a mechanism.
The explicit call stayed and is the only one; the option is not set.

**Phase 1.3 — Fix the README drift. Landed 2026-09-21.** `server/README.md` documents a
`POST /screen` taking `preset`/`rules`/`limit`/`offset` and returning
`total`/`count`/`tickers`/`results`. The real handler takes **no body** and returns
`{universe, elapsedMs, matches, near}`. Rewrite against the real handlers; stage 2 then
replaces the prose with generated OpenAPI so it cannot drift again.

*The drift was wider than the one endpoint named here.* `/facts`, `/metrics`, `/signals` and
the whole `DEV_TOOLS`-gated `/dev/*` surface were undocumented, `/backtest` was described
with a request and a result shape from a rule engine that was never built, and the file
pointed at a `server/backtest.test.ts` that does not exist. The rewrite was therefore done
against live responses captured from a running service rather than against the types alone,
and it documents the environment variables and the dataset precedence too, since those are
what a reader actually needs before the container work in stage 4.

- Touch scope: `.github/`, `server/index.ts`, `server/README.md`, and — added 2026-09-21 —
  `server/index.test.ts`, `docs/platform-hardening-plan.md`. The phase as written declared no
  test file, but shutdown ordering and the grace-period cut-off are exactly the behaviour
  that regresses silently, and a `kill -TERM` by hand cannot be run in CI.
- Verify: CI green on a PR; `kill -TERM` on the dev server closes the DB handle cleanly.
- Verify, added 2026-09-21 (the line above tests 1.2 by hand and 1.3 not at all):
  `server/index.test.ts` pins that the provider closes after the listener and only once,
  that an expired grace period still closes it and says so, and that a second signal exits
  non-zero without waiting; and every endpoint, error and environment variable in
  `server/README.md` is checked against a response from a running service or against the
  code that reads it.

---

## Stage 2 — A real HTTP service *(Track: service)*

**Phase 2.1 — Fastify. Landed 2026-09-21.** Replace the hand-rolled router, body reader and
error mapper. Routes become plugins (`routes/screen.ts`, `routes/instrument.ts`,
`routes/dev.ts`), and the `DEV_TOOLS` gate becomes **structural** — the dev plugin is only
registered when the flag is on, instead of an `if` inside the router. Delete `readJsonBody`,
`sendJson`, `sendError`, `requireJson` and the `url.startsWith` routing. Keep `RequestError`
as the 400 signal, mapped by a Fastify error handler. `/backtest` keeps NDJSON streaming.

**`handlers.ts` does not change.** That transport-agnostic seam is already the shape most
teams refactor toward; this phase only swaps what calls it. This held exactly: `handlers.ts`
is byte-identical after the migration, which is the best evidence the seam was real.

*What the implementation changed (2026-09-21).* The file list above was one plugin short.
`/health` and `/metrics` are reads of process state rather than of the universe, so they went
to a fourth plugin, `routes/system.ts`, which is also where phase 4.4 will split `/health`
from `/ready`; `/facts`, `/signals` and `/backtest` sit with `/screen`, since all four are the
engine answering questions about the warm universe. A fifth file, `routes/deps.ts`, declares
the one interface every plugin is handed, so the routes take their collaborators through
Fastify's register options instead of reaching for the module singleton — which is what lets
`app.test.ts` drive the real application over a fixture universe, and over a deliberately
broken one. `server/index.ts` survives as the entry script (`npm run dev:server` is unchanged),
and the phase-1.2 shutdown moved out of it to `server/shutdown.ts`, taking `index.test.ts`
with it as `shutdown.test.ts` — the shutdown's own guarantees under Fastify are recorded under
phase 1.2, where the claim they correct was made.

*Deleting `requireJson` was not free, and that is the useful finding.* Fastify ships content-type
parsers for `application/json` **and `text/plain`**, so simply removing the hand-written check
would have left a cross-origin `text/plain` form POST reaching `/dev/import` — the exact request
`requireJson` existed to stop. The application therefore calls `removeAllContentTypeParsers()`
and registers one parser, for JSON. All three content types a form can send without a preflight
(`text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`) now stop at **415
before a body is read**, and that protection went from two dev routes to every route. The status
changed with it: what `requireJson` answered as a 400 is now a 415, which is the more accurate
code and is what `src/lib/client/marketClient.ts` would have to provoke deliberately to see.

*Two more edges where Fastify's defaults are not the old behaviour.* `readJsonBody` resolved an
empty body as `{}`, and the stock parser rejects one with a 400 — so the registered parser keeps
the old tolerance, because `POST /screen` has always been a request with no body to speak of.
And a body over the limit is now a **413** rather than a 400; Fastify's default limit is exactly
the 1 MiB the old reader enforced, and `/dev/import`'s 64 MiB is a route option rather than a
second constant. `/backtest` hijacks its reply and writes the raw socket, because Fastify's
serialiser would hold the whole run and emit it at the end, which is the opposite of a progress
stream; that route logs its own completion, since a hijacked reply is outside the normal
response path.

**Phase 2.2 — Schemas and OpenAPI.** Introduce Zod (or TypeBox, which Fastify consumes
natively). Define every request and response shape once. Replace `parseFanBacktestBody` and
`parseFanSignalsBody` with schema parsing — the schema validates *shape*, the existing
`src/lib/strategy/parse.ts` keeps validating *meaning*. Generate OpenAPI via
`@fastify/swagger`. Optionally emit a typed client for `src/lib/client/marketClient.ts` from
the same schemas, so a route change breaks the client at compile time.

**Phase 2.3 — Structured logging and integration tests. Landed 2026-09-21.** pino with a
per-request id (Fastify ships it), replacing `console.error`. Add tests that drive the real app
over HTTP — the routing layer has essentially no coverage today.

*`console.error` was not the only one (2026-09-21).* The server also held a `console.warn` — the
latency recorder's budget breach in `metrics.ts`, which is precisely the line you want tied to a
request id — and a `console.log` for every boot and shutdown message. All three are gone from
`server/`. The routes pass their `request.log` into `metrics.record`, whose injectable `warn`
parameter already existed for tests and turned out to be the right seam for this too; the root
logger is its default, for the callers that are not inside a request. A `LOG_LEVEL` variable had
to be added to phase 4.1's config surface at the same time: a logger with no off switch is a
logger that gets commented out.

*A JSON-only logger made `npm run dev` worse before it made it better (2026-09-21).* One JSON
object per event is right for a container and wrong for a person watching a terminal, and the
service emits two of them per request, so the first thing 2.3 delivered was a noisier
development loop than the `console.log` it replaced. `pino-pretty` renders the same events as
one readable line each, and is a devDependency plus a `transport` block in `server/logger.ts`.
The gate is `nodeEnv === 'development'`, not `!== 'production'`: the package is not installed in
a production image, so the target must never be resolved there, and the narrower test also keeps
the Vitest run (`NODE_ENV=test`) from spawning a transport worker for every module that imports
the logger. Verified after wiring it that the final `shutdown complete` line still reaches the
terminal — a transport moves writing to a worker thread, and a process that exits on a signal is
exactly where a buffered last line goes missing.

Most of the new routing coverage in `server/app.test.ts` uses `app.inject()` rather than a
socket. It runs the whole Fastify lifecycle — routing, content-type parsing, hooks, the error
handler, serialisation — so it is an integration test in every sense that matters here, and it
does not leave a listener behind when an assertion fails. The cases that genuinely need the wire
(the NDJSON stream, the keep-alive drain) bind an ephemeral port through `server/testHarness.ts`.

- Touch scope: `server/index.ts` → `server/app.ts` + `server/routes/*`, `server/schemas/*`
  (new, **2.2 only**), `server/fanBacktest.ts`, `server/signals.ts`,
  `src/lib/client/marketClient.ts`. Widened 2026-09-21 for 2.1 and 2.3: `server/shutdown.ts`,
  `server/logger.ts`, `server/config.ts`, `server/testHarness.ts`, `server/metrics.ts`,
  `server/README.md`, `package.json` (pino, and `pino-pretty` as a devDependency),
  `.claude/rules/server.md` (it told an agent to keep HTTP
  details in `index.ts` and to reach for `console`, both of which this phase made false), and the server tests
  (`app.test.ts`, `shutdown.test.ts`, `config.test.ts`, and the call sites in `screen.test.ts`,
  `fanBacktest.test.ts`, `instrument.test.ts`, `tests/store.client.test.ts`), plus
  `package-lock.json` and the removal of `server/index.test.ts`, whose contents became
  `server/shutdown.test.ts`. `fanBacktest.ts`, `signals.ts` and `marketClient.ts` were in fact
  **not** touched — the wire format did not change, which was the point.
- Touch scope: also on this branch, because phase 4.1 landed with 2.1 rather than after it —
  `server/universe.ts`, `server/universe.test.ts`, `server/devImport.ts`,
  `server/devImport.test.ts`, `server/devDataset.ts`, `server/devDataset.test.ts` and
  `src/lib/data/sqlite.test.ts`. The reason is under phase 4.1; they are repeated here so a
  scope check run against this branch's phase number sees them.
- Verify: malformed bodies return 400; `/docs` renders (2.2); a deliberate response-shape
  change fails `npm run typecheck` (2.2, once the schemas exist).
- Verify, corrected 2026-09-21: the existing server tests did **not** pass unchanged and could
  not have. They constructed the server with `createScreenServer(store)` and drove
  `http.Server.listen/close`, both of which Fastify replaces; every one of them asserts the same
  thing it asserted before, over `buildApp`/`startApp`. The two assertions that genuinely moved
  are recorded above: a non-JSON content type is 415 rather than 400, and an oversized body 413
  rather than 400. Verified live on 2026-09-21 against a running service on port 8799: every
  endpoint, the NDJSON stream with its `application/x-ndjson` header, the 404/400/415 shapes, the
  `DEV_TOOLS` gate, and a `kill -TERM` that logs `shutdown complete` and frees the port.

---

## Stage 3 — First Claude feature: the portfolio screenshot reader *(Track: CCA-F)*

Deliberately placed early. It is small, genuinely useful, dependency-light, and it is the
cleanest possible CCA-F artifact: a single-call extraction task with structured output and a
human confirmation gate. It needs nothing from stages 4–6 — it can write to `localStorage`
like the rest of the app does today and migrate with everything else in stage 4.

**What it does.** You paste or upload a screenshot of your Avanza holdings. Claude returns
the positions as structured data. You confirm or correct them. The screener then knows what
you already own, so signals can be marked "you hold this" and position sizing has something
to work from.

**Architecture (per the CCA-F "which surface" decision tree):** this is a
*classification/extraction* task → **single Claude API call**, not a workflow and certainly
not an agent. Resist the pull to make it agentic; it fails the "Should I build an agent?"
gate on complexity — the task is fully specifiable in advance.

- **SDK:** `@anthropic-ai/sdk`, `new Anthropic()` (resolves `ANTHROPIC_API_KEY`, or an
  `ant auth login` profile — do not hardcode a key).
- **Model:** `claude-opus-5`.
- **Input:** a base64 `image` content block plus a text instruction.
- **Output:** structured outputs via `output_config: { format: {...} }` — *not* the
  deprecated `output_format` parameter — or `client.messages.parse()`, so the response
  validates against the schema instead of being hand-parsed.
- **Thinking:** `{ type: "adaptive" }`. Reading a dense broker table with share counts and
  average prices is exactly the kind of thing that benefits.
- **Errors:** a typed chain, most specific first — `BadRequestError` →
  `AuthenticationError` → `RateLimitError` → `APIError`. Never string-match error messages.
- **ESM note:** this repo is `"type": "module"`, so `__dirname` is undefined. For
  script-relative paths derive from `import.meta.url`; for cwd-relative reads pass the bare
  relative path.

**Three design points that are not optional:**

1. **The extraction is a proposal, never a fact.** A misread share count silently changes
   position sizing. The UI shows what Claude read, side by side with the image, and nothing
   is stored until you confirm. Ask the model for a per-row confidence and surface the low
   ones first.
2. **The screenshot is financial data.** Never log the image or the extracted holdings.
   Redact them from request logs explicitly — pino will happily serialise a whole body.
3. **Treat extracted text as data, not instruction.** Low risk here since it is your own
   screenshot, but if holdings later feed a tool-calling feature (stage 6), that boundary
   needs to already be respected.

Cost is negligible — a screenshot is on the order of 1–2K input tokens at Opus 5's
$5/1M input, so this is fractions of a cent per sync.

- Touch scope: `server/routes/portfolio.ts` (new), `server/claude/` (new — client + schemas),
  `src/components/` (the confirm UI), `package.json`.
- Verify: a real Avanza screenshot round-trips to a correct holdings table; a deliberately
  cropped/blurry one produces low confidence rather than confident nonsense; the API key is
  absent from every log line.

---

## Stage 4 — Config, secrets, container, local deploy *(Track: ops)*

This is where the "learn to deploy and manage" intent starts paying out.

**Phase 4.1 — One validated config surface. Landed 2026-09-21**, out of order, on the phase-2.1
branch: the Fastify rewrite touched every one of the scattered reads anyway, and leaving them
scattered for one more branch would have meant editing them twice. `server/config.ts` reads and
validates every env var at boot (`PORT`, `HOST`, `DEV_TOOLS`, `MARKETDATA_DB`, `NODE_ENV`, and
now `ANTHROPIC_API_KEY`), failing fast with a clear message. Today these reads are scattered
across `index.ts`, `universe.ts` and `devImport.ts`. The existing production-guard in
`universe.ts` moves here and gets tested in one place.

*The list of variables was short and the list of files was wrong (2026-09-21).* `devDataset.ts`
reads `MARKETDATA_DIR` and `devImport.ts` reads `EOD_DATA_DIR`, neither of which the paragraph
above names, and `devDataset.ts` is not in its list of files at all; `LOG_LEVEL` joined them for
phase 2.3. More to the point, "one surface" is only true if the other modules stop reading the
environment, so `universe.ts`, `devImport.ts` and `devDataset.ts` now take a validated
`ServerConfig` where they took a `NodeJS.ProcessEnv` — otherwise the config file would have been
one more reader rather than the only one. Two silent defaults became boot failures on the way:
`PORT=eight` used to serve 8787, and `DEV_TOOLS=yes` used to mean "off".

*The production guard changed shape, not just address.* In `universe.ts` it refused to build a
dev/test adapter; in `config.ts` it refuses the configuration outright, because with only
dev/test adapters in existence there is no narrower statement left to make. The observable
behaviour is the same — `universe.ts` built its default provider at module scope, so
`NODE_ENV=production` already failed the boot — but it is now stated once and tested in
`config.test.ts` rather than inferred from where an import happened to land.

*`ANTHROPIC_API_KEY` is handled as a secret from the first line that reads it*, which is the
habit phase 4.2 is about. Only its shape is checked; the value never appears in the error when
the check fails; and `ServerConfig.toJSON` reports `"[set]"` in its place, so the boot log — or
any future line that serialises the config — cannot leak it by accident. `server/config.test.ts`
asserts that `JSON.stringify(config)` does not contain the key. The shape check is
deliberately only the `sk-ant-` prefix and a non-empty unspaced tail. A stricter rule — the
first implementation also demanded twenty or more characters of `[A-Za-z0-9_-]` — encodes a
guess about a format Anthropic owns, and its failure mode is the worse one: a valid key
rejected at boot by a message insisting it is malformed. Failing late against the real API
beats failing wrong against our own regex.

**Phase 4.2 — Secrets, properly.** The repo is about to hold three: the Anthropic key, the
Börsdata key (which `docs/borsdata-ingest-plan.md` already flags as "the first secret this
repo has handled", and which travels as a *query parameter*, so every URL is one log line
from a leak), and later whatever the notification channel needs. Establish the pattern now —
secrets never in the image, never in git, never in a URL that gets logged; injected as env
at run time locally, and from a real secret store when stage 7 reaches the cloud.

**Phase 4.3 — Container and compose.** Multi-stage Dockerfile, non-root user, the market DB
mounted as a **read-only** volume (it genuinely is read-only — `sqliteProvider` opens it that
way). `compose.yml` brings up the service plus the observability stack below.

**Phase 4.4 — Health, readiness, metrics.** Split `/health` (liveness) from `/ready`
(universe built, provider open) — the current `/health` builds the universe to report its
size, which is a liveness probe doing readiness work, and under a container orchestrator that
distinction decides whether you get restart loops. Expose `metrics.ts` in **Prometheus** text
format alongside the existing JSON snapshot (keep the JSON — tests assert on it and the
budget checks are good), widen `MetricPath` beyond its two hardcoded values, and stand up
Prometheus + Grafana in compose so there is something real to look at.

- Touch scope: `server/config.ts` (new), `server/universe.ts`, `server/metrics.ts`,
  `Dockerfile`, `compose.yml`, `ops/` (new). Widened 2026-09-21 for 4.1, because the
  environment was read in two more places than the phase said: `server/devImport.ts`,
  `server/devDataset.ts`, `server/logger.ts` (new), `server/index.ts`, `server/config.test.ts`
  (new), and the tests whose fixtures build an environment — `server/universe.test.ts`,
  `server/devImport.test.ts`, `server/devDataset.test.ts` and `src/lib/data/sqlite.test.ts`,
  which imports the service seam from `server/universe.ts`.
- Verify: container boots against a mounted `dev-market.db`; missing or invalid env fails
  fast; Grafana shows screen/backtest latency against the SAD budgets.

---

## Stage 5 — The user-data store *(Track: research + trading — the keystone)*

**This is the phase that makes the other two intents possible**, and the one the migration
doc wrongly called optional. Today saved screens and saved strategies live in `localStorage`
(`src/lib/screen/storage.ts`, `src/lib/strategy/storage.ts`) and backtest runs live nowhere
at all.

- A **second database** for user data, kept strictly separate from the read-only market DB.
  Start SQLite (same operational story you already know), with a schema that would survive a
  move to Postgres in stage 7.
- **Migrations from day one** — Drizzle or Kysely. The Börsdata plan already names the
  absence of a migration mechanism as a problem (`tools/eod-import/db.ts` is a
  `CREATE TABLE IF NOT EXISTS` string). Do not repeat that here.
- `POST/GET/DELETE /screens` and `/strategies`. **`src/lib/screen/storage.ts` already injects
  its storage backend and tolerates a `null` one** — swapping `localStorage` for an
  HTTP-backed implementation is a genuinely contained change, which is real foresight in the
  existing design.
- **The `runs` table**, which is what turns this into a research platform: every backtest run
  persisted with its full config, its result, *and a fingerprint of the dataset it ran
  against* (which DB, which date range, bar count, content hash). A run you cannot reproduce
  is not a research result.
- **Multi-user, properly** (decided 2026-09-14, so this is no longer a deferred seam):
  - Every user-owned row carries an `owner_id`, and **authorization is enforced in the query
    layer, not the route handler**. The classic failure is a route that checks ownership on
    `GET /screens/:id` and forgets to on `DELETE`. Make the data-access layer incapable of
    returning another user's row rather than relying on each handler to remember.
  - **OIDC against an identity provider — do not hand-roll sessions.** Self-hosting Keycloak
    in compose fits local-first and is squarely on the ops learning goal; a hosted provider is
    the lower-effort alternative. Either way the app validates tokens and never stores a
    password.
  - **The market data stays shared and unscoped.** The warm universe is read-only reference
    data, not user data, so multi-user costs nothing there — one cache still serves everyone.
    Keep that boundary clean: user data and market data are different databases for a reason.
  - **The `/dev/*` routes must never be reachable in a multi-user deployment.** They import
    CSVs and hot-swap the active dataset for *everyone*. `DEV_TOOLS` already gates them and
    phase 2.1 makes that gate structural — with multiple users that stops being tidiness and
    becomes the thing standing between a second user and your whole dataset.
  - **Per-user cost control on the Claude routes.** The `ANTHROPIC_API_KEY` is *yours*; every
    user spending it is your bill. Rate-limit per user and cap it before stage 3's reader is
    reachable by anyone but you.

- Touch scope: `server/db/` (new), `server/routes/screens.ts`, `server/routes/strategies.ts`,
  `src/lib/screen/storage.ts`, `src/lib/strategy/storage.ts`, `src/store.ts`.
- Verify: a screen saved in one browser appears in another; a run is reproducible from its
  stored config + fingerprint; migrations run forward cleanly on an empty and a populated DB.

---

## Stage 6 — Research and signals on top *(Track: research + trading)*

**Phase 6.1 — Backtests become jobs.** A run is submitted, executes, and lands as a durable
artifact; the NDJSON stream becomes a progress *view* of a job rather than the only place the
result ever exists. This unlocks comparing runs, and it is the prerequisite for anything
long-running (parameter sweeps, walk-forward).

**Phase 6.2 — Statistical validity.** The failure modes here all produce *encouraging* wrong
answers, which is what makes them dangerous: a research platform that quietly flatters every
strategy is worse than no platform. Ordered by how badly each one bites **this** system,
measured against the real engine on 2026-09-14 (see the appendix for the numbers).

**(a) Transaction costs — unmodelled, and plausibly fatal.** `fanBacktest.ts` models no
commission, spread or slippage at all; its `cost` field is position cost basis
(`shares × entryPrice`), not friction. That matters more than usual because the stops are
tight — mean stop distance is **2.35–2.61% of entry**, so 1R is only about 2.5% of price, and
friction is a large fraction of one risk unit:

| Round-trip cost | net mean R (dev) | net mean R (kaggle) |
|---|---|---|
| 0% (as modelled today) | 0.506 | 0.649 |
| 0.5% | 0.315 | 0.436 |
| 1.0% | 0.124 | 0.224 |
| **1.5%** | **−0.068** | 0.012 |
| 2.0% | −0.259 | −0.201 |

Avanza courtage is perhaps 0.3%, but Nordic small-cap spreads alone run 0.5–2%. **Outside
liquid large caps this strategy is likely negative after costs**, and no amount of history
fixes that — it is a modelling gap, not a sample-size one. Cheapest fix in the whole plan,
largest effect: make cost a config field, charge it on entry and exit, and refuse to report a
gross-only result.

**(b) Multiple testing.** The strategy builder is, structurally, a search machine — the
expected best-of-N spurious t-statistic is ≈ √(2 ln N), so ~100 parameter variants yields
t ≈ 3.0 from pure noise. This is why finance uses a **t > 3.0** threshold rather than 2.0
(Harvey, Liu & Zhu 2016). The platform should count its own trials: the `runs` table from
stage 5 already records every run, so **deflated Sharpe** (Bailey & López de Prado 2014),
which adjusts for number of trials, non-normality and sample length, is computable from data
you are already storing. Report it next to the raw number.

**(c) Clustered standard errors.** Trades are not independent observations. Names entering
the same setup on the same day are one bet about the market regime, counted many times.
Measured intra-month ICC is 0.08–0.11, which on this entry rate gives a design effect of
2.1–3.4 — so the honest t is roughly half the naive one (4.53 → 2.24 on kaggle). **Report the
month-clustered t, never the per-trade t.** One function, and it is the difference between a
result that looks conclusive and one that is not.

**(d) Look-ahead bias** — the signal log must record what data was available at signal time,
not what the DB holds now. A backtest silently using restated or back-adjusted prices will
flatter every strategy you test.

**(e) Survivorship bias** — a universe built from today's listed names has already dropped
everything that failed. **Confirm early whether Börsdata serves delisted instruments**; if it
only returns currently-listed names, every backtest is structurally optimistic no matter how
deep the history, and that is worth knowing before phase 6.4 imports anything.

**(f) Corporate actions.** `src/lib/data/sqlite.ts` states the provider performs *no*
adjustment and "trusts the importer's pre-adjusted bars". An unadjusted 2:1 split reads as a
−50% crash and will fire or destroy signals spuriously. The Börsdata plan has splits in scope
— make sure that is actually wired, because the engine has no defence of its own.

- Verify: a backtest refuses to report without a cost assumption; the run record carries the
  clustered t and the trial count; a synthetic split in a fixture does not generate a signal.

**Phase 6.3 — The nightly signal pipeline.** A scheduled post-close job runs the strategies
and writes to an **append-only signal log**: what fired, on what data, with what entry, stop
and target. Never mutated — the value is in being able to ask "what did this tell me three
weeks ago, and was it right?". **Delivery is the UI reading that log** (decided 2026-09-14) —
no email, no push, no outbound dependency. The job's only output is rows; the UI shows what is
new since you last looked, which is a read model over the log rather than a notification
system.

**Phase 6.4 — Nordic data, with full history.** This is where `docs/borsdata-ingest-plan.md`
lands and Avanza signals become actually actionable. That plan is already written; it slots in
here. The 2026-09-14 decision to take **as much history as Börsdata will give** adds one
problem that plan does not cover, because it is a property of the *server*, not the importer:

> **The warm universe does not survive full history unchanged.** `universe.ts` builds the
> entire universe into memory at boot and holds it forever, with indicator caches on top.
> Measured on `kaggle-market.db` (1,500 instruments, 1.10M bars): **144 MB heap and a 2.0 s
> boot build**. Börsdata's Nordic universe at full history is roughly an order of magnitude
> more bars, which projects to **~1.5 GB resident and ~20 s of boot** before the service can
> serve anything.

Neither number is fatal, but both are load-bearing: 1.5 GB is a lot for one process on a
homelab box, and a 20-second cold start is exactly why phase 4.4 splits `/ready` from
`/health` — without that split an orchestrator kills the process before it finishes booting.

The fix follows from what each path actually needs, and it is cheap because the seam already
exists:

- **A screen needs a recent window, not all history.** The deepest thing it looks back through
  is EMA-200 plus the rising lookbacks — a few hundred bars. A ~500-bar warm window over
  ~1,900 Nordic instruments is roughly 120 MB, i.e. about what runs today.
- **A backtest needs full history, but phase 6.1 already made it a job.** A job can stream
  instruments from SQLite one at a time and never hold the universe at once.

So: warm window for the p95-budgeted screen path, streamed full history for the batch path.
Both go through the existing `MarketDataProvider` port, so this is a provider and store
change — no handler and no engine edits. Do this **before** importing full history, not after
discovering the boot time.

**How deep does the history need to be?** Phase 6.2's measurements answer this, and the answer
is *much* deeper than intuition suggests. Because the per-month effect ratio is 0.27–0.43 and
`t = ratio × √months`:

| Bar to clear | dev-market rate | kaggle rate |
|---|---|---|
| t = 2, gross of costs | 4.5 yr | 1.8 yr |
| **t = 3, gross of costs** | **10 yr** | **4 yr** |
| t = 3, after 0.3% round-trip | 17 yr | 6 yr |
| t = 3, after 1.0% round-trip | 169 yr | 34 yr |

**10–15 years is the defensible minimum**, and it should span 2008, 2020 and 2022 — you need
to have seen the strategy *fail*, not only work. Once the warm window above is in place there
is no memory reason to store less, and disk is not a constraint at this scale. If the Börsdata
subscription caps the depth, that cap is a real limit on what the research platform can ever
conclude, and is worth knowing before committing to a tier.

- Verify: a scheduled run produces the same signals as the same config run by hand; the
  signal log is append-only under test; a strategy's run history is comparable across
  datasets.

---

## Stage 7 — Claude, further in *(Track: CCA-F)*

Only after stage 5 exists, because each of these needs somewhere durable to read from and
write to. Ordered by the CCA-F surface-selection ladder — simplest tier that does the job.

**Phase 7.1 — Signal rationale (single call).** Given a signal and its context — the fan
state, the patterns `src/lib/patterns.ts` detected, the strategy definition — produce a short
readable "why this fired". Architecturally the interesting part is **prompt caching**: the
glossary and strategy definitions are a large stable prefix and the per-signal facts are
small and volatile, which is exactly the shape caching rewards. Put the stable content first,
the volatile content after the last breakpoint, and verify with
`usage.cache_read_input_tokens` — if it is zero across repeated calls, something in the
prefix is varying.

**Phase 7.2 — Research Q&A over runs (workflow + tool use).** "Why did this strategy
underperform in 2022?" Claude gets read-only tools over the runs and signals tables. This is
the tier where tool use earns its place — and where the **tool runner** (`@anthropic-ai/sdk`'s
`client.beta.messages.toolRunner` with `betaZodTool`) is the right amount of machinery: it
drives the loop over tools you define, without you hand-writing it, while you still host the
compute. Note this is *not* the Claude Agent SDK, which is a different package.

**Phase 7.3 — Scheduled agent (optional, CCA-F-motivated).** If stage 6.3's nightly pipeline
should do open-ended work rather than run a fixed recipe — "look at tonight's signals against
the last month's and tell me what changed" — that is the case for **Managed Agents with a
scheduled deployment**, where Anthropic runs the loop and the schedule. Worth doing for the
curriculum, but be honest that a cron plus a single call covers the fixed-recipe version, and
apply the agent gate (complexity, value, viability, cost of error) before reaching for it.

**Standing rules for this whole stage**, all of which are CCA-F content applied for real:
model `claude-opus-5` unless there is a measured reason otherwise; adaptive thinking; stream
anything with long output; structured outputs over `output_config.format`; typed error chains;
never truncate inputs silently. And build an **eval** before tuning any prompt — "it looks
better" is not a result, and phase 7.1 and 7.2 are both easy to regress invisibly.

---

## Stage 8 — Cloud *(Track: ops)*

The "later" half of local-first, taken only once stages 1–6 are steady locally.

- IaC rather than clicking. Managed Postgres for the user-data DB; the market DB either
  travels as a volume or the ingest tools run in-cluster.
- CD from the CI built in phase 1.1, deploying the image built in phase 4.3.
- Real secret storage replacing phase 4.2's env injection.
- The observability stack from phase 4.4, hosted.
- The identity provider from stage 5 moves from compose to something managed (or a hardened
  self-hosted one) — with real users this is the piece that stops being a learning exercise.

Sizing note: `dev-market.db` is 51 MB and `kaggle-market.db` 94 MB. Small enough that this
stays cheap, which is the right reason to keep the market data in SQLite rather than
"upgrading" it to a hosted database it does not need.

---

## Sequencing summary

```
1 correctness floor ──► 2 real HTTP service ──┬──► 3 Claude screenshot reader  (independent)
                                              │
                                              └──► 4 config/secrets/container
                                                        │
                                                        ▼
                                                   5 user-data store   ◄── the keystone
                                                        │
                                              ┌─────────┴─────────┐
                                              ▼                   ▼
                                    6 research + signals     7 Claude, further in
                                              │                   │
                                              └─────────┬─────────┘
                                                        ▼
                                                    8 cloud
```

Stages 1 and 2 are prerequisites for everything. Stage 3 is deliberately off the critical path
so there is a Claude feature working early. Stage 5 is the keystone — both remaining intents
are blocked on it.

## Appendix — measured baseline (2026-09-14)

Everything in phase 6.2 and the 6.4 sizing table comes from running the **default fan
strategy** (`DEFAULT_FAN_BACKTEST_CONFIG`) over the two real datasets, clustering trades by
calendar month. Re-derivable with `backtestFanUniverse(subjects, config, undefined, 1e9)` —
note the 4th argument, since `entries` is capped at 300 by default and the cap silently keeps
only the most recent ones.

| | dev-market.db | kaggle-market.db |
|---|---|---|
| Instruments / bars | 491 / 603K | 1,500 / 1.10M |
| Date range | 2018-11 → 2023-11 | 2014-11 → 2017-11 |
| Trades | 548 | 819 |
| Win rate | 31.6% | 33.2% |
| Mean R / sd | 0.506 / 3.355 | 0.649 / 4.096 |
| Mean stop distance | 2.61% | 2.35% |
| Naive t (per trade) | 3.53 | 4.53 |
| Intra-month ICC | 0.113 | 0.083 |
| Design effect | 2.10 | 3.43 |
| **Effective n** | **261** | **239** |
| **Month-clustered t** | **1.94** | **2.24** |
| Profitable months | 26 / 51 | 18 / 27 |

**The finding that decided the history question:** tripling the universe (491 → 1,500 names)
*lowered* effective sample size, 261 → 239. The extra names enter the same setup on the same
days, so they raise the design effect (2.10 → 3.43) by as much as they add trades. **Effective
n is bought with elapsed time, not with breadth** — which is why a 2-year window over 1,900
Nordic names would land near an effective n of ~225, roughly what these datasets already give,
and why the 2-year proposal was rejected.

Also worth carrying forward: the median trade returns **0.00%**. All of the expectancy sits in
the ~30% of trades that reach a trailing exit. A distribution that skewed is exactly the case
where normal-theory significance tests are least trustworthy and the deflated-Sharpe machinery
in phase 6.2(b) earns its place.

---

## Questions resolved 2026-09-14

All three of this plan's original open questions are answered and folded in above:

| Question | Answer | Where it landed |
|---|---|---|
| Notification channel for 6.3 | **UI only** — no external channel, no extra secret | Phase 6.3 |
| How much history | **As much as Börsdata gives** | Phase 6.4, plus the warm-universe change it forces |
| Single-user or accounts | **Build for multiple users** | Stage 5, and the IdP in stage 8 |

### Still open (none blocking stage 1)

- **Which identity provider.** Self-hosted Keycloak in compose maximises the ops learning;
  a hosted provider gets stage 5 done faster. Decide at stage 5, not before.
- **Börsdata tier.** How much history you actually get is a function of the subscription, and
  the phase 6.4 sizing above scales with it. Worth knowing the real bar count before building
  the warm window, though the windowed design is right at any size.
