---
id: RETRO-002
type: retro
batch: BATCH-003
created: 2026-06-28
window_start: 2026-06-28
window_end: 2026-06-28T14:21:26.373508+00:00
committed: 5
shipped: 5
---

## Committed vs shipped
- committed: STORY-050, STORY-051, STORY-053, STORY-022, STORY-033  (5)
- shipped:   STORY-050, STORY-051, STORY-053, STORY-022, STORY-033  (5)
- carried:   —  (still open at close)
- unplanned: STORY-023, STORY-026, STORY-031  (shipped, not committed)

## Metrics snapshot
- cycle: median 48m · p90 58m (n=7)
- review-check: 5/19 refused (26%) · 2 hard-gate block(s)
- bounce: 0 / 7 reached-review (0%)
- blocked: none

## Observations
- **Goal MET.** STORY-050 (fetch) + STORY-051 (ingest) both `done`; screener runs against the Yahoo DB. 5/5 committed shipped, 0 bounced, 0 carried. Cycle median 48m / p90 58m (n=7) — down ~40% from BATCH-001 (78m / ~102m).
- **Stale base-commit at Gate-4 batch close was the dominant friction.** All 5 stories ran on one shared branch (`main`) instead of the planned worktrees. Batch close stamped review-check against the sprint-start base `ee2e5e4`, so siblings' files flagged as out-of-scope: 3 refusals (STORY-022/033/050, 5+6+3 problems) + 2 hard-gate blocks + 3 `--skip-review-check` overrides at 14:17. Effective quality-enforcement rate was ~5%, not the headline 26% — STORY-051/053 passed clean (base stamped after siblings). Root cause already captured as [IDEA-005] (ignorable paths) + [IDEA-008] (worktree isolation).
- **Investment check PARTIAL — SessionStart re-grounding hook unshipped for the 2nd sprint running.** `sad-grounding` fired 0/5 stories; the skill exists and is correct, the auto-trigger is missing. Listed as a prep `note:` in BATCH-003 and a Gate-1 candidate in the plan, but never captured as a board IDEA, so it has no owner or carry-forward.
- **A named PRECONDITION ran *inside* the sprint instead of before it.** STORY-031 ("accept at Gate 4 before launch") executed at 13:12 and produced the sprint's single loudest event (25 review-check problems → override). `sprint-plan-new` accepted the commitment without verifying the precondition was `done`.
- **Healthy signals:** reviewer fan-out on STORY-051 caught a real ticker-dedupe coverage-inflation bug; STORY-050 self-review caught a silent batch-size no-op before STORY-053 branched; guard hook correctly refused a direct `git mv` bypass. The gates and fan-out worked where they fired on real per-story diffs.

## Workflow-change proposals
<!-- Top 1–3 frictions as concrete changes to a NAMED artifact (gate/file/
     tool). `board.py sprint-retro --accept P-N` flips status to accepted
     AND spawns an IDEA (capture≠commit); `--reject P-N` flips to rejected.
     NOTE: the dominant stale-base friction is deliberately NOT a row — it is
     already captured as IDEA-005 + IDEA-008; route those to next Gate-3 prep
     rather than spawning a duplicate idea here. -->

| id  | target (gate/file/tool) | type | status | result |
|-----|-------------------------|------|--------|--------|
| P-1 | `tools/hooks/` SessionStart re-grounding hook (fires `sad-grounding`) | hook | accepted | IDEA-009 |
| P-2 | `tools/board.py sprint-plan-new` precondition/`note:` handling | tool | accepted | IDEA-010 |
| P-3 | `tools/board.py validate` companion-file id matcher | tool | accepted | IDEA-011 |
