# Leveraging the Claude Code & Anthropic API in the workflow system

_Status: analysis & proposal — 2026-06-27_
_Question (Mikael): can the programmatic Claude Code / Anthropic API surface augment or
outsource parts of our workflow system? Specifically — is there a way to clear context
when it gets too large?_
_Method: two parallel agents (Claude-Code/API doc research + a full inventory of our
tooling), with the load-bearing context-management facts verified directly against
`code.claude.com/docs` and `platform.claude.com/docs`._

---

## 0. TL;DR

1. **Yes, context can be cleared — and our architecture is unusually well-suited to it.**
   `/clear` and `/compact` exist but are *interactive* (a human or a `/loop` types them; a
   skill or sub-agent cannot call them mid-task). The real win is the **`SessionStart`
   hook**, which fires with `source: "clear" | "compact" | "resume"` and can inject
   `additionalContext` *automatically*. Because our state already lives on disk (board
   folders, `events.jsonl`, SAD anchors), the conversation is **disposable** — we can clear
   aggressively between stories and a hook re-grounds the agent from `board.py`. This is the
   single highest-value, lowest-risk thing to build.

2. **Do not outsource the mechanical core.** `board.py` (24 subcommands) and the three hooks
   are 100% deterministic, and that determinism *is* the product — it's what makes the board
   trustworthy. Putting an LLM anywhere inside the gates would weaken them. Leave them alone.

3. **The right things to outsource to a direct API/headless call are the LLM-heavy steps that
   are currently invisible to the gates** — chiefly the mandatory code-review pass in the
   build loop. Making that a callable headless step (`claude -p … --output-format json`) that
   `board.py move` can require is the way to close friction **F2** (real defects slip past the
   heuristic gate) without trusting the agent to remember.

4. **The "clock" (cadence) is the other real gap.** Our loops today (`/loop`) only run while a
   session is open. A cross-session heartbeat — nightly SM retro digest, overnight action loop
   — wants OS-cron / GitHub Actions driving `claude -p`, or Claude Code's own `/schedule`.

The rest of this document maps each layer to a concrete opportunity, ranked.

---

## 1. The three surfaces we can draw on

| Surface | What it is | Where it fits us |
|---|---|---|
| **Claude Code itself** (slash commands, hooks, skills, sub-agents, headless `-p`, the Agent SDK) | The agent harness we already run inside | Context hooks, headless code-review, the cron heartbeat |
| **The Anthropic Messages API** (direct `client.messages.create`) | One-shot model calls, no agent loop | Cheap deterministic sub-tasks: classify, summarise, extract — Haiku + structured output + Batch |
| **API context-management beta** (`context_management`, memory tool) | *Server-side* clearing of old tool results | Only relevant if/when we run the build loop as our own SDK harness, not the interactive CLI |

A note on trust: items below are tagged **[verified]** (checked against live docs this session),
**[stable]** (well-established, not re-verified), or **[beta/uncertain]** (confirm the exact
flag/method against current docs before building — the SDK method names move).

---

## 2. Context management — the headline question

> _"Is there a way to have a command or skill to clear the context if it gets too large?"_

### 2.1 What exists

| Mechanism | Available? | Who can trigger it | Notes |
|---|---|---|---|
| `/clear` | **[verified]** yes | Human (or a `/loop` line) — **not** a skill/sub-agent mid-turn | Wipes conversation history; keeps the session. The API-research agent wrongly claimed this isn't a command — it is. |
| `/compact` | **[verified]** yes | Human / `/loop`; also **auto** when the window fills | Summarises rather than wipes. Takes optional focus instructions. |
| Auto-compaction | **[stable]** yes | Automatic | Clears oldest tool results first, then summarises. No agent control. |
| **`PreCompact` hook** | **[verified]** yes | Fires before manual or auto compaction | Can **block** (exit 2 / `decision:"block"`) or log; **cannot modify** the compaction. Receives `trigger: manual|auto`. |
| **`PostCompact` hook** | **[verified]** yes | Fires after compaction | Re-inject / re-ground point. |
| **`SessionStart` hook** | **[verified]** yes | Fires on new/resume/**after `/clear`**/**after `/compact`** | `source` ∈ `startup\|resume\|clear\|compact`. Returns **`additionalContext`** injected before the next turn. **This is the key primitive.** |
| API context editing (`clear_tool_uses_20250919`) + memory tool | **[verified]** yes, **beta**, **API-only** | The program making the `messages.create` call | Server-side clears old tool results at a token threshold, keeps the last N, can `exclude_tools`. **Not exposed to the interactive Claude Code agent** — only to direct API / Agent-SDK harnesses. |

**The limitation that matters:** a *skill* or *sub-agent* cannot reach up and clear its own
parent's context. `/clear` and `/compact` are driven from the top — by you, or by a `/loop`
script line. So "a skill that clears context when it's large" is not directly possible. But we
don't need it, because:

### 2.2 Why our architecture makes context disposable (the real answer)

Our whole system is built so that **truth lives in files, not in the conversation**:

- the board column **is** the folder a story sits in;
- `attempts`, `base_commit`, `sad_refs`, `reject_reason` are **frontmatter**;
- the audit trail is **`.workflow/events.jsonl`**;
- the architecture contract is the **SAD on disk**.

That means clearing the conversation between stories loses almost nothing recoverable. The
pattern to build:

```
build loop (per story):
  /clear                                  ← drop the previous story's chatter
  → SessionStart hook fires (source:"clear")
  → hook runs `board.py` and injects additionalContext:
        active batch + WIP, the in-progress story, its sad_refs sections,
        its reject_reason if bounced, Touch scope
  → agent resumes fully grounded, with a fresh window
```

A `SessionStart` hook (a sibling of our existing `workflow/hooks/*.py`) that shells out to
`board.py sprint-show --json` + the current story's `sad_refs` and emits `additionalContext`
turns "clear" from "lose the thread" into "reset to the disk-truth." This is the **cheapest,
highest-leverage** addition here, and it's a natural extension of the grounding guarantee we
already enforce.

### 2.3 Concrete proposals

- **C-1 — `SessionStart` re-grounding hook _(do this first)_.** New `workflow/hooks/session_ground.py`,
  wired in `settings.json` under `SessionStart`. On `source` ∈ `{clear, compact, resume}` it
  pulls the active batch, WIP, the single `in-progress` story and its `sad_refs`/`reject_reason`
  and returns them as `additionalContext`. Makes `/clear` safe inside `/build-toward`.
- **C-2 — `/clear` between stories in the action loop.** Once C-1 exists, the build loop can
  `/clear` after each `move review`/`blocked`, so a long `/loop /build-toward <batch>` run keeps
  a flat token profile instead of growing until auto-compaction thrashes. The WIP/batch bound
  is still the stop condition; this just keeps each story's window clean.
- **C-3 — `PreCompact` → telemetry.** A tiny hook that logs a `compact`/`refused` event to
  `events.jsonl` (reusing `workflow_log`). Gives the SM lens a "how often are we hitting the
  window" signal — useful for spotting stories that balloon context (a smell of scope creep).
- **C-4 — context editing for a future SDK harness.** *Only* if we move `/build-toward` off the
  interactive CLI onto our own Agent-SDK runner (§4.3): enable `context_management:
  {clear_tool_uses_20250919, exclude_tools:[…]}` + the memory tool so long unattended runs
  self-manage. Not needed while we stay in the interactive CLI. **[beta]**

---

## 3. Outsourcing tools — what to move, what to leave

Our inventory splits cleanly (~40% mechanical, ~60% LLM-heavy). The rule of thumb:

> **Deterministic, gate-bearing work → keep it in `board.py`/hooks. Never LLM-ify a gate.**
> **LLM judgement that is currently invisible to the gates → make it a callable API/headless
> step so a gate can require it.**

### 3.1 Leave mechanical (do **not** outsource)

`board.py`'s 24 subcommands — `move`, `check`, `set`, `validate`, `metrics`, `batch-*`,
`idea-*`, numbering, render — and all three hooks (`guard_board_mutation`,
`allow_localhost_curl`, `log_backlog_interaction`) are pure rules. Their value is that they are
*predictable*. An LLM here would trade determinism for nothing. The `story-syncer` field
mapping is mechanical too. **Verdict: untouched.**

### 3.2 The one high-value outsource: the code-review gate (closes F2)

> **✅ Shipped 2026-06-29.** Implemented as the read-only `code-reviewer` subagent
> + `board.py review-record` (writes `.workflow/review-<id>.json`) + an R-1 gate in
> `move review`/`done` that refuses a missing, stale (base/head ≠ current diff), or
> blocking artifact (human override `--skip-code-review`, logged). Built as a
> subagent rather than headless `-p`, but the gateable-precondition idea below is
> what shipped. **F2 closed.**

Today the mandatory code-review pass in `build-toward.md` is **loop discipline, not enforced**
— `board.py` can't see whether it ran. STORY-018's 10 regressions are the evidence: the
heuristic `review-check` passed; only a separate heavy review caught them.

**Proposal R-1 — make code-review a callable, gateable step.** Wrap a code-review invocation
as headless:

```bash
claude -p "Review the diff $BASE..HEAD against SAD anchors $REFS. Return findings."   \
  --output-format json --max-turns 4 --allowedTools "Read,Bash(git diff*),Grep"        \
  > .workflow/review-$ID.json
```

`board.py move <id> review` can then require a fresh `review-$ID.json` (matching `base_commit`,
no blocking findings) the same way it already requires ticked criteria — turning the heavy
review from "the agent should remember" into a **precondition**. The findings JSON also feeds
the existing fan-out-to-stories pattern automatically. **[output-format json: verified;
exact schema: confirm]**

### 3.3 Cheap one-shot API calls (Haiku + structured output + Batch)

These are LLM-light, narrow, deterministic-output tasks better served by a direct
`client.messages.create` (or a Haiku-class model) than a full agent turn:

| Candidate | Today | Outsource to | Why |
|---|---|---|---|
| **Idea-inbox triage** (`idea-list` → in-scope vs out-of-scope, dedup, "promote/archive?") | PO lens, full agent | one structured-output call over `idea-list --json` | Classification, not reasoning. Cheap, repeatable, feeds Vision gate. |
| **Metrics → prose digest** (`metrics --json` → readable health note) | agent reads JSON | Haiku one-shot | Pure summarisation of numbers the SM lens already computed. |
| **Semantic `sad_refs` check** (does the story text actually match the cited anchor, beyond the textual match `validate` does) | not done | per-story structured call, or a **Batch** job over all stories | Catches anchors that resolve textually but drifted in meaning — strengthens F8. |

- **[stable]** Structured outputs / tool-use JSON and **Batch API** (≈50% cheaper, async) are
  real. Batch is the right tool for "re-check all 27 stories against an updated SAD overnight"
  — one async job, not 27 agent turns.
- **[stable]** Model routing: the lens agents and the cheap calls above should name a
  Haiku-class model; reserve Opus for the genuinely hard reasoning (SAD authoring, decomposition,
  the heavy review). This is a frontmatter/option change, not new architecture.

### 3.4 Leave as full agents (correctly)

The authoring skills (`idea-refiner`, `poc-to-plan`, `sad-author`, `backlog-decomposer`,
`sad-grounding`) and the four lenses are multi-step reasoning over the repo — they *should* stay
full agents. The only augmentation worth it: **prompt caching** the stable prefixes (a SAD's
`#3 Capabilities`/`#6 Data` sections are re-read across many stories) when a step is reworked as
a direct API call. **[stable]**

---

## 4. The clock — cross-session cadence

§8 of `work-process-analysis.md` already wants observation loops now and a nightly scheduled
retro. Mapping that to what's actually available:

### 4.1 In-session (have it) — `/loop`
The three observation loops (SM health sweep, PO batch-prep, idea-triage nudge) and the action
loop run via `/loop` while a session is open. No change needed.

### 4.2 Cross-session heartbeat (the gap)
`/loop` dies when the session closes. To make the nightly SM digest survive:

- **K-1 — OS cron / GitHub Actions → headless Claude Code.** A scheduled job runs
  `claude -p "/sm-health" --output-format json` (or `python workflow/tools/board.py metrics && … exceptions
  && … validate`), writes the digest to a file, and pings on exceptions. This is the concrete
  form of the "scheduled routine for the nightly SM retro" §8.3 asks for. **[headless verified;
  no built-in cron in Claude Code — use the OS / Actions]**
- **K-2 — check Claude Code's own `/schedule`.** This session exposes `Cron*` scheduling tools
  and the docs reference `/schedule`; if available in our install it's a lighter path than
  standing up Actions. **[uncertain — verify in our version]**

### 4.3 Headless action-loop harness (optional, bigger)
The action loop could move from interactive `/loop /build-toward` to a small **Agent SDK**
script (`query()` / `ClaudeSDKClient`) that: picks the next in-batch story, runs the story turn
with `--max-turns`, `/clear`s between stories (§2.3 C-2), enforces the WIP bound in code, and
enables context editing (C-4) for unattended overnight runs. This buys programmatic stop
conditions and resumability (`--resume`) at the cost of maintaining a harness. Worth it only if
overnight unattended building becomes routine. **[Agent SDK exists; treat exact option names as
to-confirm]**

---

## 5. What is NOT possible (so we don't propose it)

- ❌ A **skill or sub-agent clearing its own parent's context**. `/clear` / `/compact` are
  top-level/interactive. Use the `SessionStart` hook + disk-truth re-grounding instead (§2.2).
- ❌ `/compact` / `/clear` as **headless `-p` flags**. They're interactive commands. Headless
  runs rely on auto-compaction (or context editing if using the SDK/API directly).
- ❌ The interactive Claude Code agent calling the **API context-editing beta** on its own loop.
  That beta is for direct `messages.create` / Agent-SDK harnesses, not the CLI agent.
- ❌ **Built-in cron in Claude Code** (beyond a possible `/schedule`). Cross-session cadence
  needs the OS scheduler or GitHub Actions.
- ❌ **LLM-ifying the gates.** Technically possible, strategically wrong — determinism is the
  point of `board.py`.

---

## 6. Ranked recommendation

| # | Move | Closes / enables | Effort | Risk |
|---|---|---|---|---|
| 1 | **C-1** `SessionStart` re-grounding hook | makes `/clear` safe; disposable context | S | low |
| 2 | **C-2** `/clear` between stories in the action loop | flat token profile on long runs | S | low |
| 3 | **R-1** code-review as a gateable step ✅ _shipped (subagent + `review-record` gate)_ | **F2** (defects past the gate) | M | med |
| 4 | **K-1** cron/Actions → `claude -p` nightly digest | cross-session heartbeat (§8.3) | S–M | low |
| 5 | **3.3** Haiku/structured-output for triage, digest, semantic refs | cheaper lenses; **F8** | M | low |
| 6 | **C-3** `PreCompact` telemetry | context-bloat signal for SM lens | S | low |
| 7 | **C-4 / 4.3** SDK harness + context editing | unattended overnight building | L | med |

**Start with #1.** It's small, it's a direct extension of the grounding guarantee we already
enforce, and it's the literal answer to the question that prompted this document: we can clear
context freely *because* the board, the event log, and the SAD already hold the truth — the hook
just re-hands it to the agent.

---

_Appendix — sources: live docs `code.claude.com/docs/en/hooks` (PreCompact/PostCompact/
SessionStart, verified 2026-06-27) and `platform.claude.com/docs/en/build-with-claude/
context-editing` (verified); Claude-Code/Agent-SDK/Batch/structured-output research (treat exact
SDK method + CLI-flag names as to-confirm against current docs before building); repo inventory
of `workflow/tools/board.py` (24 subcommands), `workflow/hooks/*`, `.claude/{commands,skills,agents}/*`,
`.workflow/events.jsonl`, `docs/{work-process-analysis,autonomy-tiers,sprint-ceremonies}.md`._
</content>
</invoke>
