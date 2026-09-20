# CCA-F learning plan — applying the Claude Certified Architect material to this repo

Status (2026-09-20): **in progress — phase A in progress (A.1 and A.2 landed)**. Written from Mikael's question of
what to implement here to enforce the learning of the Anthropic *Claude Certified
Architect – Foundations* (CCA-F) certification content. Intent 3 of
`docs/platform-hardening-plan.md` already names CCA-F as a product goal; this document is
the executable half of that intent. It does not replace the hardening plan — it fills the
gaps in it and gives each Claude-related phase a home. Where a phase below is already
specified in the hardening plan, this document says so and does not respecify it.

## Context — what the exam tests

The certification covers Claude Code, the Claude Agent SDK, the Claude API and the Model
Context Protocol (MCP). The exam is 60 scenario-based items in 120 minutes, in five domains:

| # | Domain | Weight | Objectives the exam probes |
|---|---|---|---|
| 1 | Agentic architecture & orchestration | 27% | agent vs workflow vs single call; the loop (gather context → act → verify); subagent spawning and task decomposition; context passing; session state; graceful failure of one agent among many |
| 2 | Tool design & MCP integration | 18% | tool descriptions written for the model; structured errors (category + retryable flag); distributing tools across agents; MCP tools / resources / prompts; server configuration; stop reasons |
| 3 | Claude Code configuration & workflows | 20% | CLAUDE.md hierarchy (user / project / directory); `.claude/rules/`; custom skills with `allowed-tools` and `context: fork`; hooks; subagents; plan vs direct execution; headless `-p` in CI with `--output-format json` |
| 4 | Prompt engineering & structured output | 20% | explicit criteria over vague instructions; few-shot; JSON schema / structured outputs; nullable fields against hallucination; validation-retry loops; Message Batches; multi-pass review |
| 5 | Context management & reliability | 15% | preserving information across sessions; escalation to a human; error propagation in multi-agent setups; large-codebase exploration; prompt caching; evals |

The six published exam scenarios are: customer-support resolution agent, Claude Code
configured for a team, multi-agent research system, developer-productivity tooling,
Claude Code in CI/CD, and structured data extraction from documents. Four of those six
map directly onto work this repo already wants.

## Where the repo stands (2026-09-18)

Measured against the domains, not against the hardening plan:

| Domain | Present | Missing |
|---|---|---|
| 1 Agentic | Hardening stage 7 sketches the single-call → tool-runner → managed-agent ladder | Nothing built. No Agent SDK use, no subagent orchestration anywhere |
| 2 Tools / MCP | `server/handlers.ts` is a transport-agnostic seam — tools can wrap it without touching the engine | No MCP server, no tool definitions, no structured tool errors |
| 3 Claude Code | `CLAUDE.md` (+ `AGENTS.md` copy), `ACRONYMS.md`, one CI workflow | `.claude/agents`, `.claude/commands`, `.claude/skills` are **dangling symlinks** into the deleted `workflow/` (removed in A.2); every hook array in `.claude/settings.json` is empty; no `.claude/rules/`; `README.md` is still the Vite template |
| 4 Prompting / output | Stage 3 of the hardening plan specifies structured outputs and per-row confidence | Nothing built. No nullable-field rule, no retry loop, no batch path |
| 5 Context / reliability | `docs/development-diary.md` is the cross-session memory; plan docs carry decisions | No eval harness, no error-propagation design, no cost/rate controls, no log redaction |

The hardening plan's stage 7 covers domain 1 and 4 well and domains 2, 3 and 5 barely at
all. Those three are 53% of the exam. The phases below are ordered so the cheapest,
highest-coverage gaps close first, and so nothing here blocks the hardening plan's own
critical path (stages 1 → 2 → 4 → 5).

### Decisions this plan assumes — from the hardening plan, do not re-open

- Server stays TypeScript; the engine in `src/lib` is shared with the browser.
- Model `claude-opus-5` unless there is a measured reason otherwise; adaptive thinking;
  structured outputs via `output_config.format`; typed error chains; stream long output.
- Advisory only: the system never places an order and never holds a broker credential.
- The screenshot and the extracted holdings are financial data — never logged.
- Build an eval before tuning any prompt.

---

## Phases

Each phase names the domain it exercises. **Key?** marks the ones that unblock others.

| # | Phase | Domain | Key? | Depends on | Track |
|---|---|---|---|---|---|
| A | Claude Code project configuration | 3 | yes | — | Claude Code |
| B | Claude Code in CI | 3, 5 | — | A, hardening 1.1 (landed) | Claude Code |
| C | Portfolio screenshot reader | 4, 5 | yes | hardening 2.x (Fastify), 4.1 (config) | API |
| D | Eval harness | 5 | yes | C | API |
| E | MCP server over the screener | 2, 3 | yes | hardening 2.x | MCP |
| F | Signal rationale with prompt caching | 4, 5 | — | C, D, hardening 5 | API |
| G | Research Q&A with the tool runner | 1, 2 | — | D, E, hardening 5 + 6.1 | API |
| H | Multi-agent research workflow (Agent SDK) | 1, 5 | — | G | Agent SDK |
| I | Nightly agent — apply the gate, record the answer | 1 | — | hardening 6.3 | Agent SDK |
| J | Reliability guidelines and cost controls | 5 | — | C | cross-cutting |

Phases A and B need no new dependencies and no other phase; they are the first branch.

---

### Phase A — Claude Code project configuration *(domain 3)*

The cheapest and most direct exam material, and it makes every later phase run better
inside Claude Code. Everything here is configuration; nothing touches product code.

**A.1 — `.claude/rules/`.** Path-scoped rules with YAML frontmatter, one file per
concern, so the guidance loads only when the matching files are being edited. The
frontmatter field is `paths:`, a list of globs (not `globs:`; a rule without `paths`
loads every session, like `.claude/CLAUDE.md`):

- `engine.md` (`src/lib/**`): shared with the browser — no Node imports, no I/O, pure
  functions; indicator math changes need golden-test updates in `tests/engine.golden.test.ts`.
- `server.md` (`server/**`): handlers stay transport-agnostic; new routes go through
  `handlers.ts`; `RequestError` is the 400 signal; `/dev/*` stays behind `DEV_TOOLS`.
- `docs.md` (`docs/**`): plan and diary format — status line, phases, touch scope,
  verify steps; diary entries are dated and say what changed, where it lives, how to test.

A fourth rule, `claude.md` (`server/claude/**`) — the standing rules from hardening stage 7
(model, thinking, structured outputs, typed errors, redaction) — is **a phase C deliverable**,
written in the branch that creates `server/claude/`. A path-scoped rule whose `paths` match
nothing is dead weight; phases D and J then extend that same file.

*Rules load; documents do not.* A matching `paths` glob pulls the rule's own text into
context and nothing else — an `@import` inside a rule would load at launch, which defeats
the point. So a plan or a measurement is reached by a **pointer**: a rule scoped to the
*source* path names the document and the condition for reading it, and the document is read
lazily when that condition hits. `engine.md` carries the first one (change `fanBacktest.ts`
→ read hardening phase 6.2 first).

The consequence for `docs/`: **do not restructure it to mirror the globs.** A rule scoped to
`docs/plans/**` fires only while a plan is being edited, which is when it is least needed.
The mapping to maintain is *source glob → rule → doc pointer*, and `docs/` stays flat while
it is legible (split it for human reasons past ~15 files, then fix the pointers).

**A.2 — Skills (slash commands).** In `.claude/skills/`, each with `allowed-tools`
declared and `context: fork` where the work should not pollute the main session:

- `/diary-entry <phase>` — appends a dated entry in the house format from the current
  diff and the plan's phase text. Reads git; writes only `docs/development-diary.md`.
- `/phase-plan <feature>` — scaffolds `docs/<feature>-plan.md` with the status line,
  context, phases table, touch scope, tests, verification, out-of-scope sections.
- `/verify` — runs `npm run typecheck`, `npm run lint`, `npm run test` and returns a
  one-screen summary; `context: fork`, tools limited to Bash + Read.
- `/touch-scope` — diffs the branch against `main` and lists files outside the active
  plan's declared touch scope. Read-only.

**A.3 — Hooks in `.claude/settings.json`.** The exam frames hooks as the mechanism for
"every time X happens", as opposed to instructions Claude may or may not follow. That is
the gap here: `npm run lint` and `npm run test` are already enforced on every PR and every
push to `main` by `.github/workflows/ci.yml` (hardening 1.1), but *locally* nothing runs
them — there are no git hooks, and every hook array in `.claude/settings.json` is empty.
The hooks shorten the feedback loop; CI stays the hard gate, so all three are advisory.

- `PostToolUse`, matcher `Edit|Write` → `.claude/hooks/lint-edited.sh` reads
  `.tool_input.file_path` from stdin and runs `eslint --fix` on that one file if it is
  `*.ts`/`*.tsx`.
- `PreToolUse` on Edit/Write → refuse paths matching `*.db`, `.env*`, and anything under
  `dist/`; warn (not block) on paths outside the active plan's touch scope.
- `Stop` → `.claude/hooks/test-if-code-changed.sh`: if `git diff --name-only` touches
  `src/` or `server/`, run the suite (2.3s for 541 tests, so run it rather than remind) and
  return a failure summary as `additionalContext`, exit 0.

Order A.2 before A.3: `/verify` gives the `Stop` hook one command to call instead of a
second copy of the typecheck/lint/test sequence.

**A.4 — Subagents in `.claude/agents/`.**

- `backtest-reviewer` — read-only tools; given a run or a diff to `fanBacktest.ts`,
  checks it against the hardening plan's 6.2 rules (costs modelled, clustered t reported,
  trial count recorded) and returns findings, not edits.
- `plan-auditor` — read-only; checks a PR against its plan's touch scope and verify steps.
- `diary-writer` — the agent behind `/diary-entry`, so the format lives in one place.

**A.5 — CLAUDE.md hierarchy and README.** Add a *user-level* `~/.claude/CLAUDE.md`
for personal conventions (language of commit messages, preferred verbosity) so the project
file stops carrying them. Rewrite `README.md` from the Vite template into a real one: what
the app is, the three intents, how to run, where the plans live. Keep `AGENTS.md` as a
byte-identical copy of `CLAUDE.md` (it is today except for the title line) and add a
CI check for that in phase B.

- Touch scope: `.claude/**`, `README.md`, `AGENTS.md`, `CLAUDE.md`.
- Verify: `/verify` runs and reports; editing a `.ts` file triggers the lint hook; a
  write to `dev-market.db` is refused; `/touch-scope` on this branch lists nothing outside
  `.claude/**` and the four docs.

---

### Phase B — Claude Code in CI *(domain 3 and 5; exam scenario 5)*

Extend `.github/workflows/ci.yml` (hardening phase 1.1) with an advisory job that runs
Claude Code headless on pull requests. Two checks that are genuinely useful here:

1. **Touch-scope check.** Does the PR diff stay inside the touch scope declared by the plan
   it names? The plan is found from the PR body (`Plan: docs/<x>-plan.md`, phase N).
2. **Diary check.** Does a change to `src/lib/fanBacktest.ts`, `src/lib/fan.ts` or
   `src/lib/strategy/**` come with a diary entry dated today?

Mechanics the exam asks about, all applied for real:

- `claude -p "<prompt>" --output-format json` with a fixed `--allowedTools Read,Grep,Glob`
  set; no Edit, no Bash. Session isolation: one invocation per PR, no resume.
- The API key from a repository secret (`ANTHROPIC_API_KEY`), never echoed; the job has
  `permissions: pull-requests: write` only for the comment step.
- Output parsed from the JSON envelope, posted as **one** PR comment, updated in place on
  the next push (same concurrency group as the existing CI job).
- **False-positive control:** the prompt lists explicit pass criteria, asks for a
  `verdict: pass | warn` per check with a one-line reason, and the job never fails the
  build — advisory for the first month, then promote the touch-scope check to blocking
  once it has not produced a wrong `warn` in ten PRs (record the count in the diary).
- A `AGENTS.md == CLAUDE.md` diff check as a plain shell step, no Claude needed — the
  exam point is knowing when *not* to use the model.

- Touch scope: `.github/workflows/ci.yml`, `.github/claude/` (new — prompt files),
  `docs/development-diary.md`.
- Verify: a PR that edits `src/lib/fanBacktest.ts` without a diary entry gets a `warn`
  comment; a PR that only edits `docs/` gets `pass` on both; a pushed fix updates the
  same comment; the key appears in no log line.

---

### Phase C — Portfolio screenshot reader *(domain 4 and 5; exam scenario 6)*

**Already specified as hardening stage 3.** Build it exactly as written there: single
Claude API call, base64 image block, structured output, per-row confidence, human
confirmation gate, typed error chain, nothing logged. This plan adds three things the
stage 3 text does not mention, each a named exam objective:

1. **Nullable fields.** Every extracted field that Claude cannot read with confidence is
   `null`, never a guess. The schema says so; the prompt says so with an explicit
   criterion ("a share count is only non-null when every digit is legible").
2. **Validation-retry loop.** If the response fails schema validation, or a row fails the
   *meaning* check (negative shares, average price outside the bar range), retry once
   with the validation error in the prompt, then surface the failure to the user. Two
   attempts, never more — record the attempt count on the result.
3. **Message Batches path.** A `tools/portfolio-backfill` script that submits a folder of
   historical screenshots as one batch, polls, and writes the results to the user-data
   store (hardening stage 5). Same schema, same prompt, half the price, no interactive
   deadline — the exam's "batch processing strategy" made concrete.

This phase also writes the fourth rule deferred from A.1: `.claude/rules/claude.md`,
scoped to `server/claude/**`, carrying the stage 7 standing rules.

- Touch scope: as stage 3 (`server/routes/portfolio.ts`, `server/claude/`,
  `src/components/`), plus `tools/portfolio-backfill/` (new) and `.claude/rules/claude.md`.
- Verify: as stage 3, plus: a blurred screenshot yields `null` fields rather than numbers;
  an injected schema violation triggers exactly one retry; the batch script round-trips
  three fixtures and reports per-item status; `.claude/rules/claude.md` exists and loads
  when a file under `server/claude/` is opened.

---

### Phase D — Eval harness *(domain 5)*

Hardening stage 7 says "build an eval before tuning any prompt" but gives it no phase.
This is that phase, and it is the reliability answer for phases C, F, G and H.

- `server/claude/evals/` — fixtures (screenshots + expected holdings JSON; later
  signal-rationale inputs + rubric), a runner under Vitest, and a report: exact-match
  rate, field-level accuracy, null-rate, mean confidence on wrong fields (the number that
  tells you whether confidence means anything).
- Runs are **opt-in** (`npm run eval`), not part of `npm test`, because they cost money
  and need a key. CI runs them only on a `run-evals` label.
- Every prompt change to `server/claude/` cites the eval delta in its diary entry. That
  rule goes into `.claude/rules/claude.md` from phase A.
- Multi-pass review as an eval strategy: for the rationale prompt (phase F), a second
  call grades the first against a rubric — cheaper than hand-labelling, and the exam's
  "multi-pass review" objective.

- Touch scope: `server/claude/evals/` (new), `package.json`, `.github/workflows/ci.yml`.
- Verify: `npm run eval` prints a table; a deliberately weakened prompt lowers the score;
  the fixtures contain no real account numbers (synthetic or redacted screenshots only).

---

### Phase E — MCP server over the screener *(domain 2 and 3)*

Wrap the existing seam as MCP. `handlers.ts` already takes a parsed request and a warm
universe and returns a plain result, so this is small — and it exercises tool design,
MCP primitives, and Claude Code configuration in one phase.

**Tools** (each wraps an existing handler; no engine changes):

| Tool | Wraps | Notes |
|---|---|---|
| `screen_fan` | `handleScreen` | returns matches + near, capped and paginated |
| `scan_signals` | `handleSignals` | takes a strategy id or a full config |
| `get_instrument` | `store.getInstrument` | bars for one ticker, with a `bars` limit |
| `list_runs` / `get_run` | stage 5 runs table | once it exists; read-only |

**What the exam actually grades, applied here:**

- Descriptions written for the model: what the tool is for, when *not* to call it, what
  the units are (R, percent, bars), and an example call. Not the JSDoc.
- **Structured errors**: every failure returns `{ errorCategory, isRetryable, message }`
  — `invalid_input` (not retryable), `unknown_ticker` (not retryable), `universe_cold`
  (retryable), `internal` (retryable once). `RequestError` maps to `invalid_input`.
- **Resources**: the help glossary (`src/help/glossary.ts`) as `glossary://<topic>`, and
  the strategy presets — stable reference data the model should *read*, not call a tool
  for.
- **Prompts**: two canned research prompts ("compare this strategy across datasets",
  "explain why this ticker matched"), so the prompt primitive is exercised too.
- **Registration**: the server in `.claude/settings.json` (`mcpServers`) so Claude Code
  sessions in this repo can query the live screener. Also the answer to "which tools does
  a subagent get" — the `backtest-reviewer` from phase A gets `list_runs`/`get_run` and
  nothing else.

Transport: stdio for local Claude Code use; the same server mounted over HTTP behind the
Fastify app once hardening 2.1 lands, gated like `/dev/*` until stage 5 brings auth.

- Touch scope: `server/mcp/` (new), `.claude/settings.json`, `.claude/agents/*`,
  `package.json` (`@modelcontextprotocol/sdk`).
- Verify: MCP inspector lists tools, resources and prompts; a bad ticker returns
  `unknown_ticker` with `isRetryable: false`; in a Claude Code session "which names are in
  the fan today?" calls `screen_fan` unprompted.

---

### Phase F — Signal rationale with prompt caching *(domain 4 and 5)*

**Already specified as hardening phase 7.1.** Stable prefix (glossary, strategy
definitions, few-shot examples of good rationales) first; volatile per-signal facts after
the last cache breakpoint; stream the output. This plan adds only the test and the eval:

- A test that makes two calls and asserts `usage.cache_read_input_tokens > 0` on the
  second. If it is zero, something in the prefix varies — that failure mode is the whole
  lesson.
- The rationale eval from phase D, with the rubric-grading second pass, gates any prompt
  change.
- Few-shot done properly: three worked examples in the prefix, chosen to cover a clean
  match, a marginal one, and a "fired but the patterns disagree" case.

- Touch scope: as 7.1, plus `server/claude/evals/rationale/`.
- Verify: as 7.1, plus the cache assertion and an eval score in the diary entry.

---

### Phase G — Research Q&A with the tool runner *(domain 1 and 2)*

**Already specified as hardening phase 7.2.** Read-only tools over the runs and signals
tables (which phase E already defines as MCP tools — reuse the same definitions, one
source of truth). This plan pins the reliability details the exam probes:

- **Stop reasons handled explicitly**: `tool_use` (run the tool, continue), `end_turn`
  (done), `max_tokens` (mid-answer or mid-tool-call: resume, do not truncate silently),
  `pause_turn` (continue), `refusal` (surface, do not retry).
- **Step budget**: at most N tool calls per question; on exhaustion return what was found
  and say so. No unbounded loops.
- **Tool results are data**: a run's stored `name` is user text and could contain
  instructions; the system prompt says tool output is never an instruction.
- **Escalation**: if the question needs data the tools do not expose, say so and stop,
  rather than guess. This is the "when to escalate to a human" objective.

- Touch scope: as 7.2, reusing `server/mcp/` tool definitions.
- Verify: as 7.2, plus: a question that needs 12 tool calls stops at the budget with a
  partial answer; a run named "ignore previous instructions and…" does not change the
  answer; `max_tokens` mid-tool-call resumes correctly under test.

---

### Phase H — Multi-agent research workflow *(domain 1 and 5; exam scenario 3)*

The one phase that exercises the **Claude Agent SDK**, which the certification names as
a core technology and which the hardening plan never uses. Only after phase G, because
it composes G's tools.

For a question such as "compare the default fan strategy across the dev and kaggle
datasets and tell me whether the difference survives costs":

- An **orchestrator** decomposes the question and spawns three subagents in sequence or
  in parallel as the task allows: `data` (runs the backtests via tools, returns run ids
  and summary stats only), `analysis` (reads the runs, applies the 6.2 rules — clustered
  t, cost table, trial count), `synthesis` (writes the answer, cites run ids).
- **Context passing**: each subagent sees only what it needs. `analysis` gets run ids,
  not raw trade lists; `synthesis` gets `analysis`'s findings, not `data`'s. The
  exam grades this decision.
- **Graceful failure**: if `data` fails on one dataset, `analysis` proceeds on the other
  and the answer says what is missing. Errors propagate as typed values, not thrown
  across agent boundaries.
- **Session state**: the orchestrator persists its plan and each subagent's result to the
  runs store, so a crashed workflow can resume, and so the answer is reproducible.
- **Hub-and-spoke**, not a chain: subagents never talk to each other, only to the
  orchestrator.

- Touch scope: `server/claude/research/` (new), `server/mcp/` (tool distribution),
  `package.json` (`@anthropic-ai/claude-agent-sdk`).
- Verify: the question above produces an answer citing two run ids and the clustered t;
  killing the `data` subagent for one dataset yields a partial answer that says so; the
  eval from phase D scores the synthesis against a rubric.

---

### Phase I — Nightly agent: apply the gate, record the answer *(domain 1)*

**Already hardening phase 7.3**, marked optional there. This plan keeps it optional but
makes the *decision* a deliverable: before building anything, apply the agent gate —
complexity, value, viability, cost of error — to the nightly signal job in writing, in
the diary. The likely answer is "cron plus a single call covers the fixed recipe", and
writing that down is as much CCA-F material as building the agent would be. If the
open-ended variant ("what changed versus last month?") is wanted, it is a Managed Agents
scheduled deployment, and phase H's orchestrator is the thing it would run.

- Touch scope: `docs/development-diary.md`; code only if the gate says build.
- Verify: the diary entry states the four gate answers and the decision.

---

### Phase J — Reliability guidelines and cost controls *(domain 5, cross-cutting)*

A short `docs/claude-integration-guidelines.md` that every phase above cites, plus the
controls that must exist before hardening stage 5 lets a second user near the Claude
routes:

- **Per-user rate limit and daily spend cap** on every Claude route; the key is yours and
  every user spends it. Enforced in one middleware, tested once.
- **Log redaction**: pino serializers that drop image blocks, extracted holdings and the
  API key from every log line — tested by grepping a captured log.
- **One typed error hierarchy** shared by the HTTP routes and the MCP server, so an
  `AuthenticationError` from the SDK maps to the same category everywhere.
- **Escalation rule**: any extraction with a row below the confidence threshold is shown
  to the user before it is stored; any agent answer that hit its step budget is marked
  partial in the UI.
- **Metrics**: widen `MetricPath` in `server/metrics.ts` (hardening 4.4 already plans
  to) to include `claude_call`, with input/output tokens, cache-read tokens and cost per
  call, so the Grafana board from 4.4 shows what the Claude features cost.

- Touch scope: `docs/claude-integration-guidelines.md` (new), `server/claude/`,
  `server/metrics.ts`, `.claude/rules/claude.md`.
- Verify: a second user hitting the rate limit gets 429 with a retry-after; a captured
  log of a portfolio call contains neither the image nor a share count; `/metrics`
  reports token counts after one Claude call.

---

## Sequencing

```
A Claude Code config ──► B Claude Code in CI          (first branch; no dependencies)

hardening 2 (Fastify) ──► C screenshot reader ──► D eval harness ──► F rationale (caching)
                     └──► E MCP server ─────────┐                        │
                                                 └──► G tool runner ◄─────┘   (needs hardening 5, 6.1)
                                                            │
                                                            ▼
                                                    H multi-agent (Agent SDK)
                                                            │
                                                            ▼
                                                    I nightly-agent gate

J guidelines + cost controls: written at C, enforced before hardening stage 5 opens routes
```

Phases A and B can land this week. C, D and E follow hardening stage 2 and are independent
of each other. F, G and H wait for the user-data store (hardening stage 5), which is the
same keystone the research and trading intents wait for.

## Tests

- Phase A: hook behaviour is verified by hand (see phase verify lines); skills are
  exercised on this branch and the outputs kept in the PR.
- Phase B: the workflow is tested by three deliberate PRs (scope violation, missing diary,
  docs-only) before it is merged.
- Phases C–H: unit tests mock the SDK client at the transport boundary (a recorded
  response per fixture); the eval harness (D) runs against the real API on demand.
- Phase E: MCP tool tests call the handler directly and assert the structured-error
  shape; one end-to-end test through the stdio transport.
- Phase J: redaction and rate limit have their own tests; both run in `npm test`.

## Verification

Each phase's verify line is the acceptance test. Across the plan:

1. Every one of the five exam domains has at least one landed phase that a diary entry
   describes in exam terms (which objective, applied where).
2. No phase added an unbounded loop, an unlogged 500, or a secret in a URL or log.
3. The hardening plan's status line references this plan for its stage 3 and 7 phases so
   the two documents do not drift.

## Risks

- **Doing the config phase and stopping.** Phase A is easy and satisfying; domains 1 and
  2 are 45% of the exam and need C–H. Keep the sequencing table honest in the status line.
- **Evals as an afterthought.** D is small but it is the only thing that makes F, G and H
  measurable. It is marked key for that reason.
- **Cost.** Each phase's cost is fractions of a cent per call at the volumes here, but
  phase H and the batch path can multiply calls. The spend cap in J is not optional once
  multi-user arrives.
- **Over-building.** The exam repeatedly asks *when not* to use an agent. Phases C (single
  call) and I (the gate, written down) exist to practise that answer.

## Out of scope (deliberately)

- Broker execution, or any tool that could place an order — see the hardening plan's
  design invariant.
- Cloud deployment platform courses (Bedrock, Vertex). They are on the prep list but
  hardening stage 8 is where the cloud choice is made; revisit then.
- A customer-support-style agent. It is an exam scenario but has no product home here;
  phase G covers the same objectives (escalation, tool loops, step budgets) on real data.

## Sources

- [Claude Certified Architect – Foundations — Anthropic Academy](https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification)
- [Preparation courses — Anthropic Academy](https://anthropic-partners.skilljar.com/page/claude-certified-architect-foundations-prep-courses)
- [The Claude Certified Architect Exam: 5 domains, 6 scenarios](https://dev.to/aws-builders/the-claude-certified-architect-exam-5-domains-6-scenarios-and-everything-you-need-to-know-4le3)
- [freeCodeCamp — CCA-F prep](https://www.freecodecamp.org/news/claude-certified-architect-foundations-prep-for-anthropic-s-new-certification-exam/)
- [Pearson VUE — Claude certification program](https://www.pearsonvue.com/us/en/anthropic.html)
