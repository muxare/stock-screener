---
id: IDEA-020
type: idea
status: inbox
captured: 2026-07-08
discovery_type: out-of-scope
born_from: STORY-056
found_by: claude
why: Workflow governance (workflow/tools/board.py review-check diff basis + gate ordering); no SAD-002 capability. Review-check diffs base_commit..HEAD, so when a spine/enabler story sits in review while a dependent built atop it merges to done, the dependent's out-of-scope edits bleed into the spine's diff and fail the Acceptance gate. Seen on STORY-056 (kernels/** seam) flagged for src/lib/dag/eval.test.ts, which was actually STORY-041's edit. Fix candidates: (a) diff the story's own commit range not base..HEAD; (b) rule that a spine/enabler must be accepted before dependents land. Surface at BATCH-006 retro.
---

# IDEA-020 — Review-check false-positive: spine diff contaminated by dependent merged during review

Workflow governance (workflow/tools/board.py review-check diff basis + gate ordering); no SAD-002 capability. Review-check diffs base_commit..HEAD, so when a spine/enabler story sits in review while a dependent built atop it merges to done, the dependent's out-of-scope edits bleed into the spine's diff and fail the Acceptance gate. Seen on STORY-056 (kernels/** seam) flagged for src/lib/dag/eval.test.ts, which was actually STORY-041's edit. Fix candidates: (a) diff the story's own commit range not base..HEAD; (b) rule that a spine/enabler must be accepted before dependents land. Surface at BATCH-006 retro.

_Capture≠commit: firewalled from the build loop until a human promotes it through Vision gate (refine → plan → SAD amendment/ADR)._
