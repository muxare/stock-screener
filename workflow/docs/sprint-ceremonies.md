# Sprint ceremonies: planning & retrospective

_Status: STEP 1 (Sprint Planning) landed — 2026-06-27. STEP 2 (Retrospective)
landed — 2026-06-27 (§5; ships with the minimal slice of #16 — the
provenance-stamped idea inbox `board.py idea-new`/`idea-list` — that the
`--accept` landing needs). STEP A leftovers landed — 2026-06-27 (`/capture-idea`
command + the idea-inbox surface in `render`/`render-html`, A6/A8). STEP 3
(loops) landed — 2026-06-27 (§8; observation loops + scheduled retro digest
documented, the `/build-toward` action loop bounded by WIP)._
_Builds on `workflow/docs/work-process-analysis.md` (§5 agile mapping, §7 five gates, §8
PO/SM lenses). Designed by an expert panel (agile coach + way-of-work engineer +
Claude Code expert), synthesised here._

---

## 0. The idea in one paragraph

A **sprint** is the existing **`batch`** (the Commit-gate commitment) wrapped in two
ceremonies: **Planning** before it opens and a **Retrospective** at its close. It
is **scope-boxed, not time-boxed** — `sprint-plan-new` opens it, `sprint-close`
ends it, and a sprint lasts exactly one batch's worth of work, however long that
takes. No new container, **no sixth gate**: planning is *prep for Commit gate* (the
human still commits) and retro is *prep for process change* (the human still
decides). The load-bearing rule everywhere: **agents prepare and enforce; the
human decides at the five gates.**

This is the concrete mechanism for retiring the "four hats" of
work-process-analysis §5 — the Scrum-Master and Product-Owner roles become
advisory agent *lenses* that make Gates 3 and 5 cheaper, not a sixth checkpoint.

---

## 1. Sprint = batch (the decision)

The `batch` already *is* the sprint container: single-active invariant, a `created`
date (window start), `batch-close` (window end), `capabilities`, a `wip_limit`, and
a `## Goal`. So **a sprint reuses `type: batch` / `BATCH-NNN` on disk** — "sprint"
is the UX label on the commands and the board view. No migration; the live
BATCH-001 stays valid (the new fields are additive and optional).

| Scrum thing | This system | Status |
|---|---|---|
| Sprint backlog | the active batch's capabilities → committed stories | exists |
| Sprint commitment | `sprint-plan-new` (= enriched `batch-new`), Commit gate | **enriched** |
| Sprint goal | batch `## Goal` (now an outcome, not a task list) | **enriched** |
| Sprint planning | the `/sprint-plan` ceremony → the `sprint-plan-new` call | **added** |
| Sprint review/demo | Acceptance gate acceptance per story | exists |
| Sprint retrospective | `/sprint-retro` ceremony at close | **added** (§5) |
| Sprint close | `sprint-close` (= `batch-close`) | exists (alias) |

---

## 2. The sprint plan artifact (the enriched batch)

`sprint-plan-new` writes an enriched `BATCH-NNN.md` (all new pieces optional, so
legacy `batch-new` still produces a valid file):

- **`stories:`** frontmatter — the specific committed STORY ids.
- **`## Goal`** — ONE falsifiable, capability-anchored outcome (the goal is the
  in-scope tiebreaker during the sprint), distinct from…
- **`## Stories committed`** — the manifest (the bet on *how* to reach the goal).
- **`## Execution strategy`** — how Claude Code agent teams run it: parallel
  (independent worktrees) vs serialized stories, reviewer fan-out, tier.
- **`## Preparation / enablers`** — "work that makes future sprints easier",
  tracked per line as `story:ID` (committed enabler) · `idea:ID` (firewalled
  groundwork) · `note:text` (inert).

**Preparation work** is standard agile *enabler work* and carries a `work_type` on
the story (`feature | enabler | spike | techdebt | tooling`, default `feature`).
Committed enablers ride the story path (build loop); forward groundwork rides the
**firewalled** idea inbox (capture≠commit — it can't be built without a human at
Vision gate). The retro→planning handoff is the literal loop by which each sprint makes
the next one cheaper.

---

## 3. The planning team (`/sprint-plan`)

Four **read-only** advisory subagents (`.claude/agents/`) run in **three waves** —
PO + dev-team sense the work in parallel (blind to each other), the scrum-master then
builds the parallelization map on their output, and claude-code-leverage designs the
mechanics on the SM's map — then the command synthesises ONE proposed plan the human
ratifies at the Commit gate:

| Lens | Angle | Prepares |
|---|---|---|
| **product-owner-lens** | vision · value & scope | long plan (roadmap across epics/features + ladder-up check) + short plan (draft sprint goal + value-ordered anchored todos + DoR pass); **never invents scope** |
| **scrum-master-lens** | parallelization & flow | parallelization map (parallel lanes vs serialized spine) + split-for-parallelism recommendations + WIP as a safe-parallelism ceiling; blocks/aging |
| **dev-team-lens** | engineering reality | feasibility, sizing, sequencing/parallelism, rework risk, enabler nominations |
| **claude-code-leverage** | agent-team leverage | execution strategy + prep work via CC primitives (skills/hooks/agents/scaffolding) |

The command checks there is no active sprint, runs the four in three waves
(PO + dev-team → scrum-master → claude-code-leverage), reconciles conflicts (e.g. PO's
6 stories vs SM's safe-parallelism ceiling of 3 → propose 3, note the deferred), and
emits the exact `sprint-plan-new` command for the human to run and
edit. **It does not run it** — that call is the Commit-gate commitment.

---

## 4. Tooling surface (landed)

`workflow/tools/board.py`:
- `sprint-plan-new --goal --capabilities --stories --prep --exec-strategy --wip --id`
  — Commit gate commit; enriches `cmd_batch_new` (single-active reused). `batch-new`
  stays as the legacy terse form.
- `sprint-show [BATCH-NNN] [--json]` — goal + committed stories with their **live**
  board column + prep + WIP. The "are we on track for the goal" surface.
- `sprint-close BATCH-NNN` — alias of `batch-close`.
- `validate` additions — committed stories must be real & traceable; **commitment
  drift** warns (a committed story whose `capability` is outside the sprint); the
  **prep firewall** blocks an `idea:` prep item that already has a board file
  (groundwork smuggling into the build loop) and requires `story:` prep to be in
  the committed list.
- `render` — `board.md` shows the **Active sprint** with goal, committed stories +
  live columns, and prep.

Tests: `workflow/tools/tests/test_board_sprint.py` (27 checks) + the existing
`test_board_gates.py` stay green.

---

## 5. Retrospective (STEP 2 — LANDED 2026-06-27)

_Built as specified below. `board.py sprint-retro` (scaffold + `--accept`/`--reject`),
`metrics --sprint/--since/--until` windowing, the `RETRO-NNN.md` artifact under
`backlog/retros/`, the validate rules (§5.4), the `board.md` banner (§5.5), tests in
`workflow/tools/tests/test_board_sprint.py` (§5.6), and the `/sprint-retro` command + the four
already-wired lens agents (§5.7). The sequencing dependency (§5.8) was resolved by
**landing the minimal slice of #16** — the provenance-stamped idea inbox
(`idea-new`/`idea-list`, enriched `IDEA.template.md`, the firewall validate rule) — so
`--accept` calls the shared `_write_idea` allocator. **Stale-idea archival (A5)
landed 2026-06-27** — `board.py idea-archive [--days N] [--dry-run]` moves inbox
ideas past the `STALE_IDEA_DAYS` (90) horizon to `backlog/ideas/archive/`,
`idea-list` flags them `STALE`, and `validate` nudges (non-blocking). **STEP A is
now complete (2026-06-27)** — `/capture-idea` (the A6 thin command with the
in-scope→STORY / out-of-scope→IDEA fork) plus the A8 idea-inbox surface in both
`board.py render` (the `## Idea inbox` section in board.md) and `render-html` (the
**Idea inbox** tab + banner chip) landed, with render tests in
`test_board_sprint.py`. **STEP 3 (loops) landed (2026-06-27)** — documented in §8._

Run at `sprint-close` by the **same roster** that planned. **Prep for process
change**, never an orphan report. The retro is a *different lifecycle object* from
the batch (authored at close, embeds a frozen metrics snapshot, and its proposal
statuses keep mutating after the sprint closes) — so it gets **its own
`RETRO-NNN.md` file**, not an edit to the closed batch.

### 5.1 The ritual (what `/sprint-retro` drives)

1. **Goal verdict (PO lens)** — MET / PARTIAL / MISSED, one paragraph of evidence
   (committed scope vs what reached `done`; cite story ids + columns).
2. **Commitment accuracy (SM lens)** — committed N, shipped M, bounced B, deferred
   D, trend vs last sprint. *Reported, never rewarded* (anti velocity-gaming).
3. **Friction surfacing (SM + dev-team + CC-leverage)** — each names friction
   against evidence: which guard fired, which story bounced and why, where
   review-check was overridden, what blocked and how long, tooling fights.
4. **Investment check (PO lens)** — did the planned prep/enabler work (`work_type ≠
   feature`) actually ship, or did features crowd it out?
5. **Proposal generation** — turn the top 1–3 frictions into concrete
   workflow-change proposals, each phrased as a change to a *named artifact*.
6. **Landing (the critical step)** — route each proposal to a gate; unrouted
   proposals are dropped, not archived.
7. **`sprint-close`** with the retro summary attached.

### 5.2 `RETRO-NNN.md` schema (new artifact, `backlog/retros/`)

```markdown
---
id: RETRO-001
type: retro
batch: BATCH-001            # the sprint this retros (must be closed/closing)
created: <YYYY-MM-DD>
window_start: <batch.created>
window_end: <batch-close event ts, or now if still closing>
committed: 6               # len(stories:) at close
shipped: 4                 # committed stories that reached done within the window
---

## Committed vs shipped
- committed: STORY-026, 027, 028, 029, 021, 023  (6)
- shipped:   STORY-027, 028, 021, 025            (4)
- carried:   STORY-026, 023, 029                 (still open at close)
- unplanned: STORY-025                           (shipped, not committed)

## Metrics snapshot          # frozen copy of `metrics --sprint BATCH-001`
- cycle: median 17m · p90 2h13m (n=4)
- review-check: 3/9 refused (33%) · 1 hard-gate block
- bounce: 1 / 4 reached-review (25%)
- blocked: STORY-015 18h (longest)

## Observations
- <evidence-anchored friction, one bullet each>

## Workflow-change proposals      # tracked, not orphan prose
| id  | target (gate/file/tool)         | type    | status   | result    |
|-----|---------------------------------|---------|----------|-----------|
| P-1 | board.py done-gate              | tool    | accepted | IDEA-008  |
| P-2 | STORY.template `## Touch scope` | file    | proposed | —         |
| P-3 | Acceptance gate acceptance checklist     | gate    | rejected | —         |
```

Proposal `status` ∈ {proposed, accepted, rejected}. An **accepted** proposal
becomes an **IDEA** in the inbox (never a story directly — a workflow change has no
product `sad_refs`, so capture≠commit forces it through Vision gate). The `result` cell
records the spawned `IDEA-NNN`.

### 5.3 `board.py` surface to add (minimal, idiomatic)

- **`metrics --sprint BATCH-NNN`** (and/or `--since/--until`) — scope the existing
  `compute_metrics` aggregates to the sprint window (`batch.created` → close-event
  ts, or now). Add params + arg wiring; default behavior unchanged.
- **`sprint-retro [--batch BATCH-NNN] [--accept P-id] [--reject P-id]`** —
  `cmd_sprint_retro`:
  - no flags → scaffold `RETRO-NNN` from the closing/closed batch: committed-vs-shipped
    delta + a frozen `metrics --sprint` snapshot.
  - `--accept P-id` → flip status to accepted **and** spawn an IDEA (`born_from:
    RETRO-NNN`, `found_by: retro`, `why:` = the target); write the id into `result`.
  - `--reject P-id` → flip status to rejected.
  - **Refuse** to author a retro on an *active* batch ("close the sprint first").
- **New constants/helpers:** `RETROS = backlog/retros`, `RETRO_ID =
  re.compile(r"^RETRO-\d{3}$")`, `all_retros()` (mirror `all_batches`),
  `sprint_window(batch_fm)` resolver. **Reuse:** `_next_item_id`, `read_backlog_file`,
  `dump_fm`, `committed_stories`, `find_story`/`all_stories` (live columns), `_log`,
  `compute_metrics`, `active_batch`.

### 5.4 Validation (add to `cmd_validate`)

- Each `RETRO-NNN.batch` must resolve to a real batch.
- **Warn** on >1 retro per batch.
- Every proposal `status` ∈ {proposed, accepted, rejected}.
- An **accepted proposal with an empty `result`** → problem ("dangling — no
  resulting IDEA/STORY").
- (Retro-only-on-closed-sprint is enforced in `cmd_sprint_retro`, not bulk validate.)

### 5.5 Render

`board.md`: if a `RETRO-NNN` exists for the most-recently-closed batch, a banner
`Retro RETRO-001 · N proposals open` (count of `status: proposed`). `render-html`:
add the same to the batch chip.

### 5.6 Tests (`workflow/tools/tests/test_board_sprint.py`, extend)

- `sprint-retro` on an **active** batch → refused; on a **closed** batch → scaffolds
  `RETRO-001` with `batch:`, `committed`/`shipped`, and an embedded metrics snapshot.
- `metrics --sprint BATCH-001` excludes events outside `[created, close]` (seed one
  in-window + one out-of-window move; assert the out-of-window one isn't counted).
- Proposal lifecycle: `--accept P-1` → status accepted, spawns `IDEA-NNN` with
  `born_from: RETRO-001`, writes the id into `result`; `--reject P-2` → rejected;
  an accepted proposal with empty `result` → `validate` problem.

### 5.7 `/sprint-retro` command + agents

`.claude/commands/sprint-retro.md` re-convenes the **same four agents** (already
built) with retro-focused prompts (each agent file already has an "In sprint RETRO
you produce" section — wire them, don't rewrite). It reads the windowed metrics +
events + committed-vs-shipped, converges the four into the proposal table, and
records `RETRO-NNN`. Like `/sprint-plan`, the agents are read-only and the human
decides which proposals to `--accept`.

### 5.8 Sequencing dependency (READ FIRST)

The "accepted proposal → IDEA" landing wants the **idea-inbox return-edge**
(`workflow/docs/work-process-analysis.md` §10 STEP A / **#16**: `board.py idea-new`,
provenance-stamped inbox), which is **not built yet** (`cmd_idea_new` absent; the
`backlog/ideas/IDEA.template.md` is still the bare 6-line form). Two options:
- **Land #16 first** (recommended — it's small and the whole system already wants
  it), then `sprint-retro --accept` calls the shared idea-writer; **or**
- have `--accept` write the IDEA file directly via `dump_fm` in the interim and
  refactor to the shared allocator when #16 ships.

STEP A (#16) build steps are spec'd in `workflow/docs/work-process-analysis.md` §10 "STEP A".

---

## 6. Anti-patterns guarded

- **No sixth gate** — every ceremony output maps to an existing gate (planning →
  Commit gate; retro proposals → Vision gate via the idea inbox, or Commit gate as anchored debt).
- **No scope invention** — the PO lens orders existing anchored work only; every
  committed item (incl. enablers) needs `sad_refs`; DoR enforced at planning.
- **No velocity-gaming** — the *goal verdict*, not story-count, is the sprint's
  success measure; commitment accuracy is reported, never rewarded.
- **No orphan reports** — the retro emits routed proposals with a `lands_at`, not prose.
- **No board mutation by agents** — the four lenses are `tools:`-restricted to reads.
- **No investment crowd-out** — `work_type` + the retro's investment check make
  "planned 3 enablers, shipped 0" a visible, recurring finding.

---

## 7. Try it

```bash
python3 workflow/tools/board.py sprint-show                 # the active sprint at a glance
/sprint-plan CAP-screen                            # convene the planning team (read-only)
# review the proposal, then commit at the Commit gate (edit as you like):
python3 workflow/tools/board.py sprint-plan-new \
  --goal "…" --capabilities CAP-screen --stories STORY-0xx,STORY-0yy \
  --prep "idea:IDEA-00n,note:…" --exec-strategy "…" --wip 3
python3 workflow/tools/board.py render                       # board.md shows the active sprint
# …build via /build-toward CAP-screen … then at close:
python3 workflow/tools/board.py sprint-close BATCH-NNN
# STEP 2 — retrospective on the closed sprint:
/sprint-retro                                       # convene the same team (read-only)
python3 workflow/tools/board.py sprint-retro --batch BATCH-NNN          # scaffold RETRO-NNN (data)
python3 workflow/tools/board.py metrics --sprint BATCH-NNN             # the frozen window snapshot
# review the proposals, then land them at a gate:
python3 workflow/tools/board.py sprint-retro --batch BATCH-NNN --accept P-1   # → spawns an IDEA (Vision gate)
python3 workflow/tools/board.py sprint-retro --batch BATCH-NNN --reject P-2
python3 workflow/tools/board.py idea-list                              # the firewalled inbox the retro fed
```

---

## 8. Cadence — the loops (STEP 3, optional)

_Added 2026-06-27. STEP 3 = STEP C / #18 of `workflow/docs/work-process-analysis.md` §10.
Timebox-free Kanban has no natural clock; `/loop` (in-session) and scheduled
routines (across sessions) give it one **without standing up meetings**. The loops
drive the already-built read-only surfaces and ceremonies — they add no new
judgement, just a heartbeat. Partitioned by risk: observation loops are safe now;
the one action loop is gated behind Phase 1 (which has landed)._

### 8.1 Two risk classes

| Class | What it does | Safe to run | Stop condition |
|---|---|---|---|
| **Observation** | reads board state, emits to a gate | **now** — cannot harm flow | a cadence (you read the digest and act, or not) |
| **Action** (`/build-toward`) | mutates the board (starts/advances stories) | **only after Phase 1** (done) | the **WIP/batch bound**, never wall-clock |

### 8.2 Observation loops (C1 — safe now)

All read-only; each lands its output at a named gate. Drive them with `/loop`
(self-paced or on an interval) while you're in a session:

- **SM health sweep → Exception gate/retro.** Flow & process health off the event log:
  ```
  /loop python3 workflow/tools/board.py metrics ; python3 workflow/tools/board.py exceptions ; python3 workflow/tools/board.py validate
  ```
  Surfaces WIP breaches, aging stories, the exception queue, and validate nudges.
  The Scrum-Master lens (via `/sprint-retro` at close) reads the same surfaces.
- **PO batch-prep → Commit gate.** Convene the read-only planning team to propose the
  next batch (it never commits — that's your Commit gate call):
  ```
  /loop /sprint-plan <capability-hint>
  ```
- **Idea-inbox triage nudge → Vision gate.** Surface fresh + stale captures so the
  inbox stays signal and nothing rots unpromoted:
  ```
  /loop python3 workflow/tools/board.py idea-list
  ```
  (Pair with `idea-archive` when the stale count climbs — A5.)

These never mutate the board, so they can light up immediately and start buying
back attention.

### 8.3 Scheduled routine — nightly SM retro digest (C2)

The in-session `/loop` dies with the session. For a heartbeat that **survives
across sessions**, schedule the SM health sweep as an overnight cron-style routine
(via `/schedule`): a nightly digest of `metrics` + `exceptions` + `validate` so
the morning starts with the board's state already summarised at the Exception gate, no
watching the stream. This is the "the machine's standup" the event log always made
possible — the routine just delivers it on a clock.

### 8.4 Action loop — `/loop /build-toward <batch>` (C3)

Now eligible (Phase 1's hard review-check gate makes unattended runs safe). It
**must carry the WIP/batch bound as its stop condition or it churns** — the full
spec lives in `.claude/commands/build-toward.md` (“Driving with /loop”). A
practical split: in-session `/loop /build-toward` for "work this batch while I'm
here"; the observation routine (§8.3) for the cross-session heartbeat.

### 8.5 The honest-loop rule

The standing risk of any loop is noise nobody reads. The guardrail is the same one
that governs the lenses: **every loop's output must land at a named gate** (SM →
Exception gate/retro; PO → Commit gate; triage → Vision gate; the action loop → Acceptance gate acceptance).
A loop that emits to no gate is dropped, not scheduled.

