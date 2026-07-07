---
description: Run a fan-out FEAT — spawn one isolated-worktree agent per child, concurrently, once the Scrum-Master disjointness proof is current. Spine-first, WIP-bounded, reviewer fan-out, ordered merge. Usage: /fanout <FEAT-id> [tier=A1|A2|A3]
---

# /fanout <FEAT-id> [tier]

Execute a **parallel-parent**: a FEAT marked `fanout: true` whose children are a
**verified-disjoint lane set**, run as concurrent Claude Code agents in **isolated
git worktrees**. Design: `workflow/docs/backlog-refinement.md` §6. This is **pure
orchestration over already-authored stories** — it invents no scope.

## The guard (why this is safe, not merge thrash)
Wide fan-out is safe **only** with three things in place; this command refuses
without them:
1. **A current disjointness proof.** The FEAT must be `fanout: true` with a
   **current** `fanout_verified` stamp and `fanout_children` whose Touch scopes are
   **pairwise disjoint**. A story edit that changed a child's Touch scope invalidates
   the stamp — re-run `/refine`'s SM check (or `board.py validate`) before fanning
   out. *This is the direct fix for the RETRO-001/002 shared-branch friction (stale
   base-commit → review-check mis-fires when siblings share a branch).*
2. **Isolated worktrees.** Each child runs in its **own** git worktree — never a
   shared branch. Disjoint scopes + isolation = no cross-child collision.
3. **Contract-first spine landed first.** If `fanout_spine` is set, that slice reaches
   `done` **before** any limb starts.

## Loop
```
/fanout FEAT-0nn [tier=A2]

1. READ FEAT-0nn. REFUSE unless: fanout: true AND fanout_verified is current AND
   board.py validate reports the child Touch scopes pairwise-disjoint.
     python3 workflow/tools/board.py show FEAT-0nn        # inspect the proof
     python3 workflow/tools/board.py validate             # must pass the fanout rule
   If stale/overlapping: stop and route back to /refine (re-stamp or split first).

2. SPINE FIRST (if fanout_spine set): run that one slice serialized to done —
     board.py move <spine> in-progress → build (sad-grounding) → code-review →
     board.py review-record → board.py move <spine> review → human accepts → done.
   Do NOT fan out until the shared surface has landed.

3. FAN OUT the children concurrently, bounded by fanout_wip (fallback: the active
   batch wip_limit / DEFAULT_WIP_LIMIT). For each child, in its OWN worktree:
     git worktree add ../wt-<child> -b <child>-lane
     (in that worktree) /build-toward <child> at <tier>   # sad-grounding fires;
                                                           # base_commit stamped on
                                                           # first move in-progress
   Never build two children on the same branch — that reintroduces the stale-base bug.

4. REVIEW FAN-OUT: high-rework lanes (async/error-state, races) get a specialist
   code-reviewer before review — per the claude-code-leverage lens. Each child:
     spawn code-reviewer on the child diff vs its base_commit →
     board.py review-record <child> < findings.json → board.py move <child> review

5. MERGE in the SM's declared order (spine consumers last). The human accepts each at
   the Acceptance gate: board.py move <child> done  (re-runs the gate on the real
   per-child diff — clean, because scopes are disjoint and worktrees were isolated).
   Then: git worktree remove ../wt-<child>.

6. REPORT per child: done / review / blocked, plus any SAD conflict needing a human
   decision (likely a new ADR in SAD#8). Run board.py exceptions for anything blocked.
```

## Bounds & termination
- **WIP is the concurrency ceiling**, not throughput: never run more children at once
  than `fanout_wip` / the batch `wip_limit`. At the cap, let a lane finish before
  starting the next.
- **Terminate** when every child is `done`/`review`/`blocked`. Do not widen scope to
  keep the fan-out fed — children outside `fanout_children` are invisible to this run.
- If a child bounces at the Acceptance gate, it re-enters via its own worktree lane
  (read `reject_reason` first); a bounce does **not** block its disjoint siblings.

## Anti-patterns guarded
- **No unproven fan-out** — refuses without a current disjointness proof (step 1).
- **No shared branch** — one worktree per child (step 3); the whole point.
- **No scope invention** — runs only `fanout_children`; new work is `/refine`'s job.
- **No spine skip** — a shared surface lands serialized first (step 2).
