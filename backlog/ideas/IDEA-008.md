---
id: IDEA-008
type: idea
status: inbox
captured: 2026-06-28
discovery_type: out-of-scope
born_from: STORY-050
found_by: BATCH-003 execution (orchestrator)
why: review-check (the move review/done hard gate) diffs base_commit..worktree, which assumes each story is isolated on its own branch/worktree. Running BATCH-003 as multiple stories committed to one shared branch means early stories' base_commit predates sibling commits, so 'move done' flags sibling files as out-of-scope (confirmed: STORY-033/022/050 refused; 051/053 pass only because their base_commit was stamped after siblings). Fixes: (a) enforce worktree isolation per story (already the plan's intent), or (b) make the gate diff each story's own commit range rather than base..worktree, or (c) extend ignorable() / per-story path-scoping. Workaround this sprint: move done --skip-review-check for the early stories (isolated review-check already passed at move-review with explicit --base).
---

# IDEA-008 — Single-branch multi-story sprint defeats the move-done gate for non-tip stories

review-check (the move review/done hard gate) diffs base_commit..worktree, which assumes each story is isolated on its own branch/worktree. Running BATCH-003 as multiple stories committed to one shared branch means early stories' base_commit predates sibling commits, so 'move done' flags sibling files as out-of-scope (confirmed: STORY-033/022/050 refused; 051/053 pass only because their base_commit was stamped after siblings). Fixes: (a) enforce worktree isolation per story (already the plan's intent), or (b) make the gate diff each story's own commit range rather than base..worktree, or (c) extend ignorable() / per-story path-scoping. Workaround this sprint: move done --skip-review-check for the early stories (isolated review-check already passed at move-review with explicit --base).

**Carry-priority (RETRO-002): #1 (with [[IDEA-005]]) for the next `/sprint-plan` (enabler). Land the gate fix before the multi-story DAG sprint (STORY-039–047), which re-hits this same shared-branch wall at 9-story volume. See RETRO-002 § Carry-forward.**

_Capture≠commit: firewalled from the build loop until a human promotes it through Gate 1 (refine → plan → SAD amendment/ADR)._
