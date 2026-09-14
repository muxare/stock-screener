# Platform hardening plan — from dev tool to research + signal platform

Status (2026-09-14): **proposed — stage 1 open**. Follows the Option C decision recorded in
`docs/server-migration-plan.md`: the server stays TypeScript and gets hardened rather than
ported. This document is the executable half.

## The three intents, and what each one demands

Mikael confirmed the product is all three of these at once. They are not in conflict, but
they pull on different parts of the system, and the phases below are ordered so that each
one unblocks the next rather than being done in parallel by one person.

| Intent | What it actually demands |
|---|---|
| **Research platform** — try out trading strategies | Backtest runs must be **durable, reproducible and comparable**. Today a run is an ephemeral NDJSON stream that is rendered once and lost. A research platform needs the run, its config, and *the exact data it ran against* recorded together. |
| **Trading platform** — entries to consider at Avanza | A **scheduled** post-close pipeline and an **immutable signal log**. What matters is not just today's signals but what the system said last Tuesday and what data it said it from. Plus Nordic coverage, which is the in-flight `docs/borsdata-ingest-plan.md`. |
| **Learning platform** — deploy/manage it, apply CCA-F | Infrastructure stops being overhead and becomes a **deliverable**. Containers, CI/CD, observability, secrets and a local→cloud path are the point, not a tax. And the Anthropic **Claude Certified Architect – Foundations** material gets applied to real features here, not toy ones. |

### Two decisions taken (2026-09-14) — do not re-open

- **Deployment: local first, cloud later.** Build for containers now, run on your own
  hardware, treat the cloud move as a distinct later stage.
- **Avanza: advisory + read-only portfolio sync. No order execution.** Signals are entries
  *to consider*; you place them yourself. Portfolio sync is either typed in by hand or read
  by Claude from a screenshot of the Avanza account.

### One design invariant that falls out of that

> **The system never places an order and never holds a broker credential that could.**

This is worth stating explicitly because it is what keeps the reliability bar sane. An
advisory system that is wrong costs you a bad trade you chose to take. An execution system
that is wrong costs you money while you sleep, and needs idempotency, reconciliation, kill
switches and a regulatory conversation. Everything below is scoped to the first.

---

## Stage 1 — The correctness floor *(Track: service)*

Small, no design decisions, unblocks everything. Do this first.

**Phase 1.1 — CI.** `.github/workflows/ci.yml`: `npm ci` → `npm run typecheck` →
`npm run lint` → `npm run test` on push and PR, Node 24. This is the single biggest gap in
the repo today — `.github/workflows` does not exist, so tests and lint are manual.

**Phase 1.2 — Graceful shutdown.** `UniverseStore.close()` exists and is **never called**;
there is no `SIGTERM`/`SIGINT` handler in `server/index.ts`, so the SQLite handle leaks on
every restart. Wire signals to `server.close()` + `productionUniverse.close()`. This matters
more than it looks: everything from stage 4 onward runs in a container, where `SIGTERM` is
how the process is asked to stop.

**Phase 1.3 — Fix the README drift.** `server/README.md` documents a `POST /screen` taking
`preset`/`rules`/`limit`/`offset` and returning `total`/`count`/`tickers`/`results`. The real
handler takes **no body** and returns `{universe, elapsedMs, matches, near}`. Rewrite against
the real handlers; stage 2 then replaces the prose with generated OpenAPI so it cannot drift
again.

- Touch scope: `.github/`, `server/index.ts`, `server/README.md`.
- Verify: CI green on a PR; `kill -TERM` on the dev server closes the DB handle cleanly.

---

## Stage 2 — A real HTTP service *(Track: service)*

**Phase 2.1 — Fastify.** Replace the hand-rolled router, body reader and error mapper.
Routes become plugins (`routes/screen.ts`, `routes/instrument.ts`, `routes/dev.ts`), and the
`DEV_TOOLS` gate becomes **structural** — the dev plugin is only registered when the flag is
on, instead of an `if` inside the router. Delete `readJsonBody`, `sendJson`, `sendError`,
`requireJson` and the `url.startsWith` routing. Keep `RequestError` as the 400 signal, mapped
by a Fastify error handler. `/backtest` keeps NDJSON streaming.

**`handlers.ts` does not change.** That transport-agnostic seam is already the shape most
teams refactor toward; this phase only swaps what calls it.

**Phase 2.2 — Schemas and OpenAPI.** Introduce Zod (or TypeBox, which Fastify consumes
natively). Define every request and response shape once. Replace `parseFanBacktestBody` and
`parseFanSignalsBody` with schema parsing — the schema validates *shape*, the existing
`src/lib/strategy/parse.ts` keeps validating *meaning*. Generate OpenAPI via
`@fastify/swagger`. Optionally emit a typed client for `src/lib/client/marketClient.ts` from
the same schemas, so a route change breaks the client at compile time.

**Phase 2.3 — Structured logging and integration tests.** pino with a per-request id
(Fastify ships it), replacing `console.error`. Add tests that drive the real app over HTTP —
the routing layer has essentially no coverage today.

- Touch scope: `server/index.ts` → `server/app.ts` + `server/routes/*`, `server/schemas/*`
  (new), `server/fanBacktest.ts`, `server/signals.ts`, `src/lib/client/marketClient.ts`.
- Verify: existing server tests pass unchanged; malformed bodies return 400 with field-level
  detail; `/docs` renders; a deliberate response-shape change fails `npm run typecheck`.

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

**Phase 4.1 — One validated config surface.** `server/config.ts` reads and validates every
env var at boot (`PORT`, `HOST`, `DEV_TOOLS`, `MARKETDATA_DB`, `NODE_ENV`, and now
`ANTHROPIC_API_KEY`), failing fast with a clear message. Today these reads are scattered
across `index.ts`, `universe.ts` and `devImport.ts`. The existing production-guard in
`universe.ts` moves here and gets tested in one place.

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
  `Dockerfile`, `compose.yml`, `ops/` (new).
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
- Auth: single-user is fine to start, but put the seam in — every row carries an owner, even
  if there is only ever one. Retrofitting that is far worse than carrying it.

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

**Phase 6.2 — Reproducibility guards.** Two failure modes that make a research platform
actively harmful if unaddressed, because both produce *encouraging* wrong answers:
- **Look-ahead bias** — the signal log must record what data was available at signal time,
  not what the DB holds now. A backtest silently using restated or back-adjusted prices will
  flatter every strategy you test.
- **Survivorship bias** — a universe built from today's listed names has already dropped
  everything that failed. Worth at least knowing and documenting for each dataset, since the
  Stooq/Kaggle/Yahoo DBs differ here.

**Phase 6.3 — The nightly signal pipeline.** A scheduled post-close job runs the strategies
and writes to an **append-only signal log**: what fired, on what data, with what entry, stop
and target. Never mutated — the value is in being able to ask "what did this tell me three
weeks ago, and was it right?". Delivery (email/push/web) hangs off the log, not off the job.

**Phase 6.4 — Nordic data.** This is where `docs/borsdata-ingest-plan.md` lands and Avanza
signals become actually actionable. That plan is already written; it slots in here.

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

## Open questions (not blocking stage 1)

- **Notification channel for stage 6.3** — email, push, or just the web UI? Decides what
  external dependency and which secret the nightly pipeline needs.
- **How much history does the research platform need?** Walk-forward and parameter sweeps
  change the storage and job design; worth knowing before stage 6.1 rather than after.
- **Single-user forever, or eventually accounts?** Stage 5 puts the owner seam in either way,
  but it changes how hard the auth story has to be in stage 8.
