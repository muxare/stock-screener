---
description: Convene the planning team (PO + Scrum-Master + Dev-team + Claude-Code-leverage lenses) to prepare a proposed sprint plan for the human Commit-gate commitment. Usage: /sprint-plan [capability-hint]
---

# /sprint-plan [capability-hint]

Run **Sprint Planning** — a ceremony that prepares the Commit-gate commitment. A
"sprint" here IS the existing **batch** (`workflow/tools/board.py`) plus this planning
ritual and a retrospective at close; it is **scope-boxed, not time-boxed** (it
ends when `sprint-close` is run). This command **prepares**; it does not commit.
**The human commits at the Commit gate** by running `board.py sprint-plan-new`.

## Invariant (do not break)
**Agents prepare; the human decides at the gate. This adds NO sixth gate.** The
four lenses are **read-only** — they may run only *read* `board.py` subcommands
and read files; they never `move`/`new`/`set`/`batch-new`/`sprint-plan-new` or
edit anything. Planning that auto-committed a batch would BE a sixth gate — it
must not. Nothing here mutates the board.

## Precondition
There must be **no active sprint** (the Commit gate is one commitment at a time). Check
`python3 workflow/tools/board.py sprint-show`. If one is active, the prior sprint must be
closed (and ideally retro'd) first — surface that to the human and stop.

## The team (staged — sense first, then plan)
The lenses run in **three waves**, not all at once, so each planner has the full
picture the earlier waves produced. All stay **read-only**; none mutates anything.

**Wave 1 — sense the work (parallel, blind to each other).** Spawn these two
concurrently (one message, parallel Agent calls); they are independent perspectives
and must NOT see each other's output — the independence is the point:

1. **product-owner-lens** — owns the product vision on two horizons: a long plan
   (roadmap across epics/features + a ladder-up check that the goal advances a real
   epic) and a short plan (draft sprint goal + value-ordered anchored todos + DoR
   pass). (vision · value & scope)
2. **dev-team-lens** — feasibility, sizing, the coupling/dependency read (which
   stories share files and so can't run in parallel), rework risk, and enabler/spike
   nominations grounded in the SAD + code + tech-health register. (engineering reality)

**Wave 2 — plan the parallelism.** When Wave 1 returns, pass **both** outputs to:

3. **scrum-master-lens** — with the PO's priorities and the dev-team's coupling read
   in hand, it builds the parallelization map: which todos run as concurrent worktree
   agents vs a serialized spine, split-for-parallelism recommendations, and WIP as a
   safe-parallelism ceiling. It builds **on** the coupling read rather than re-deriving
   it, but still verifies the critical overlaps against the real Touch scopes.
   (parallelization & flow)

**Wave 3 — design the machine.** Pass the SM's parallelization map (plus Wave 1) to:

4. **claude-code-leverage** — turns the parallelization map into execution mechanics
   (worktree assignment, reviewer fan-out, tier, SDK/Batch for bulk lanes) **and**
   preparation work — new skills/subagents/hooks/scaffolding — that makes future
   sprints faster.

Pass each the `[capability-hint]` (if given) as the area of focus. Each still reads
the board itself for raw state — the waves share the earlier lenses' *analysis*, not
a pre-digested board.

## Synthesize ONE proposed sprint plan
Gather the four outputs and reconcile them into a single proposal. Resolve
conflicts explicitly (e.g. PO wants 6 stories, SM's safe-parallelism ceiling is 3
→ propose 3, note the 3 deferred). The proposal must contain:

- **Sprint goal** — one falsifiable, capability-anchored outcome sentence (from PO,
  goal-first). Not a task list.
- **Committed capabilities** — the SAD#3 caps the goal needs.
- **Committed stories** — the value-ordered, capacity-bounded, Ready set (story ids).
  Every one must already be a traceable todo story; **never invent a story**.
- **WIP limit** — the SM's safe-parallelism ceiling.
- **Execution strategy** — the SM's parallelization map (lanes / spine / merge order)
  turned into CC-leverage mechanics: worktree assignment, reviewer fan-out, tier.
- **Preparation / enablers** — enabler/spike/techdebt/tooling that makes future
  sprints easier. Mark each: `story:ID` (a committed, SAD-anchored enabler — also in
  the committed stories) · `idea:ID` (firewalled groundwork awaiting Vision gate triage)
  · `note:text` (a bare thought, no id). Respect **capture≠commit**: groundwork that
  needs new architecture is an IDEA, not a story.

Present the proposal as readable markdown, then emit the **exact Commit gate command**
for the human to run (and edit) — do not run it yourself:

```
python3 workflow/tools/board.py sprint-plan-new \
  --goal "<the sprint goal>" \
  --capabilities CAP-a,CAP-b \
  --stories STORY-0xx,STORY-0yy \
  --prep "story:STORY-0zz,idea:IDEA-00n,note:<thought>" \
  --exec-strategy "<one-line execution plan>" \
  --wip <N>
```

## Where it lands (no orphan output)
Everything maps to an existing gate:
- The goal, committed scope, WIP → **Commit gate** (`sprint-plan-new`, human runs it).
- Any out-of-scope discovery the team surfaced → an **IDEA** for **Vision gate** triage
  (capture≠commit), never a story you invent here.
- Anything blocked the SM surfaced → the **Exception gate** exception queue.

After the human commits, `board.py sprint-show` and `board.md` show the active
sprint (goal + committed stories' live columns + prep). The build loop runs via
`/build-toward <capability>` inside the committed capabilities, bounded by the WIP
limit. At close, run the retrospective with the **same team**
(`/sprint-retro` — the planned next ceremony) before opening the next sprint.
