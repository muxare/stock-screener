---
description: Convene the same four lenses (PO + Scrum-Master + Dev-team + Claude-Code-leverage) to run a sprint retrospective on a CLOSED sprint and prepare workflow-change proposals. Usage: /sprint-retro [BATCH-NNN]
---

# /sprint-retro [BATCH-NNN]

Run the **Sprint Retrospective** — the STEP-2 ceremony that closes the loop a
`/sprint-plan` opened. A "sprint" IS the existing **batch** (`workflow/tools/board.py`); the
retro is **prep for process change**, not a sixth gate. This command **prepares**
proposals; the **human decides** which to land (`sprint-retro --accept/--reject`).

## Invariant (do not break)
**Agents prepare and enforce; the human decides at the gate. This adds NO sixth
gate.** The four lenses are **read-only** — they run only *read* `board.py`
subcommands and read files; they never `move`/`set`/`sprint-retro --accept` or edit
anything. Every output must **land at a named gate or it isn't built** (accepted
proposal → an IDEA at the Vision gate, capture≠commit; in-scope techdebt → a candidate for
Commit gate). No orphan reports.

## Precondition
The sprint must be **closed**. Check `python3 workflow/tools/board.py sprint-show`. If a
sprint is still active, run `board.py sprint-close <id>` first (or stop and surface
that to the human). `board.py sprint-retro` refuses to retro an active sprint.

## Scaffold the retro artifact (data first)
Run `python3 workflow/tools/board.py sprint-retro [--batch BATCH-NNN]` (defaults to the most
recently closed sprint). It writes `backlog/retros/RETRO-NNN.md` with the
committed-vs-shipped delta and a **frozen** windowed metrics snapshot
(`metrics --sprint BATCH-NNN`). The lenses read this; they do not recompute it.

## The team (fan out in parallel)
Spawn these four advisory subagents **concurrently** (one message, parallel Agent
calls) — independent lenses, each with the retro-focused half of its prompt
("In sprint RETRO you produce"). Pass each the RETRO id + the windowed metrics +
committed-vs-shipped:

1. **product-owner-lens** — the **goal verdict** (MET / PARTIAL / MISSED, evidence-
   anchored) + an **investment check** (did planned enabler/prep work ship, or did
   features crowd it out?). (value & scope)
2. **scrum-master-lens** — **commitment accuracy** (committed N, shipped M, bounced,
   deferred; trend vs last sprint — *reported, never rewarded*) + flow friction from
   the metrics/events. (flow & process)
3. **dev-team-lens** — engineering friction: which stories bounced and why, rework
   hotspots, where review-check was overridden, enabler debt. (engineering reality)
4. **claude-code-leverage** — tooling/agent-team friction: guard-fights, scaffolding
   gaps, where a skill/hook/subagent would have saved the sprint time. (CC leverage)

## Synthesize the proposal table (the ritual)
Converge the four into the retro's **`## Workflow-change proposals`** table. Each
proposal is a concrete change to a **named artifact** (a gate, a file, a tool), with
`status: proposed`. Cap at the top **1–3** frictions — a retro that proposes
everything lands nothing. Edit `RETRO-NNN.md` to fill `## Observations` (one
evidence-anchored bullet each) and append the proposal rows:

```
| id  | target (gate/file/tool)         | type    | status   | result |
|-----|---------------------------------|---------|----------|--------|
| P-1 | board.py done-gate              | tool    | proposed | —      |
| P-2 | STORY.template `## Touch scope` | file    | proposed | —      |
```

## Where it lands (no orphan output)
Present the synthesis as readable markdown, then emit the **exact commands** for the
human to run (do not run the accept/reject yourself):

```
python3 workflow/tools/board.py sprint-retro --batch BATCH-NNN --accept P-1   # → spawns an IDEA (Vision gate)
python3 workflow/tools/board.py sprint-retro --batch BATCH-NNN --reject P-2
```

- An **accepted** proposal becomes an **IDEA** in the inbox (`born_from: RETRO-NNN`,
  `found_by: retro`) — a workflow change has no product `sad_refs`, so capture≠commit
  forces it through **Vision gate**. Never author a story directly.
- In-scope techdebt the team surfaced → a candidate for the next **Commit gate** sprint plan.
- Anything blocked → the **Exception gate** exception queue.

After the human accepts/rejects, `board.py validate` enforces that no accepted
proposal is left dangling (every accepted one records its spawned IDEA), and
`board.md` shows the retro banner with the count of still-open proposals. The
retro→planning handoff is the literal loop by which each sprint makes the next one
cheaper — feed accepted IDEAs into the next `/sprint-plan`.
