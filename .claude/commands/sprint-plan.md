---
description: Convene the planning team (PO + Scrum-Master + Dev-team + Claude-Code-leverage lenses) to prepare a proposed sprint plan for the human Gate-3 commitment. Usage: /sprint-plan [capability-hint]
---

# /sprint-plan [capability-hint]

Run **Sprint Planning** — a ceremony that prepares the Gate-3 commitment. A
"sprint" here IS the existing **batch** (`tools/board.py`) plus this planning
ritual and a retrospective at close; it is **scope-boxed, not time-boxed** (it
ends when `sprint-close` is run). This command **prepares**; it does not commit.
**The human commits at Gate 3** by running `board.py sprint-plan-new`.

## Invariant (do not break)
**Agents prepare; the human decides at the gate. This adds NO sixth gate.** The
four lenses are **read-only** — they may run only *read* `board.py` subcommands
and read files; they never `move`/`new`/`set`/`batch-new`/`sprint-plan-new` or
edit anything. Planning that auto-committed a batch would BE a sixth gate — it
must not. Nothing here mutates the board.

## Precondition
There must be **no active sprint** (Gate 3 is one commitment at a time). Check
`python3 tools/board.py sprint-show`. If one is active, the prior sprint must be
closed (and ideally retro'd) first — surface that to the human and stop.

## The team (fan out in parallel)
Spawn these four advisory subagents **concurrently** (one message, parallel
Agent calls) — they are independent lenses and must not see each other's output:

1. **product-owner-lens** — drafts the sprint goal + value-orders existing
   SAD-anchored todos; runs a Definition-of-Ready pass. (value & scope)
2. **scrum-master-lens** — last sprint's metrics → a realistic WIP + story count;
   surfaces blocks/aging. (flow & capacity)
3. **dev-team-lens** — feasibility, sizing, sequencing/parallelism, rework risk,
   and enabler/spike nominations grounded in the SAD + code. (engineering reality)
4. **claude-code-leverage** — the execution strategy (which stories run as parallel
   agents in worktrees vs serialized; reviewer fan-out; tier) **and** preparation
   work — new skills/subagents/hooks/scaffolding — that makes future sprints faster.

Pass each the `[capability-hint]` (if given) as the area of focus, and the current
board/metrics context. They read the board themselves; don't pre-digest it for them.

## Synthesize ONE proposed sprint plan
Gather the four outputs and reconcile them into a single proposal. Resolve
conflicts explicitly (e.g. PO wants 6 stories, SM's capacity says 3 → propose 3,
note the 3 deferred). The proposal must contain:

- **Sprint goal** — one falsifiable, capability-anchored outcome sentence (from PO,
  goal-first). Not a task list.
- **Committed capabilities** — the SAD#3 caps the goal needs.
- **Committed stories** — the value-ordered, capacity-bounded, Ready set (story ids).
  Every one must already be a traceable todo story; **never invent a story**.
- **WIP limit** — the SM's recommended cap.
- **Execution strategy** — the CC-leverage plan: parallel groups vs serialized,
  reviewer fan-out, tier.
- **Preparation / enablers** — enabler/spike/techdebt/tooling that makes future
  sprints easier. Mark each: `story:ID` (a committed, SAD-anchored enabler — also in
  the committed stories) · `idea:ID` (firewalled groundwork awaiting Gate-1 triage)
  · `note:text` (a bare thought, no id). Respect **capture≠commit**: groundwork that
  needs new architecture is an IDEA, not a story.

Present the proposal as readable markdown, then emit the **exact Gate-3 command**
for the human to run (and edit) — do not run it yourself:

```
python3 tools/board.py sprint-plan-new \
  --goal "<the sprint goal>" \
  --capabilities CAP-a,CAP-b \
  --stories STORY-0xx,STORY-0yy \
  --prep "story:STORY-0zz,idea:IDEA-00n,note:<thought>" \
  --exec-strategy "<one-line execution plan>" \
  --wip <N>
```

## Where it lands (no orphan output)
Everything maps to an existing gate:
- The goal, committed scope, WIP → **Gate 3** (`sprint-plan-new`, human runs it).
- Any out-of-scope discovery the team surfaced → an **IDEA** for **Gate 1** triage
  (capture≠commit), never a story you invent here.
- Anything blocked the SM surfaced → the **Gate 2/5** exception queue.

After the human commits, `board.py sprint-show` and `board.md` show the active
sprint (goal + committed stories' live columns + prep). The build loop runs via
`/build-toward <capability>` inside the committed capabilities, bounded by the WIP
limit. At close, run the retrospective with the **same team**
(`/sprint-retro` — the planned next ceremony) before opening the next sprint.
