---
id: RETRO-001
type: retro
batch: BATCH-001
created: 2026-06-28
window_start: 2026-06-26
window_end: 2026-06-28T08:01:44.390720+00:00
committed: 0
shipped: 0
---

## Committed vs shipped
- committed: —  (0)
- shipped:   —  (0)
- carried:   —  (still open at close)
- unplanned: STORY-021, STORY-023, STORY-025, STORY-026, STORY-027, STORY-028, STORY-032, STORY-035, STORY-048, STORY-049  (shipped, not committed)

## Metrics snapshot
- cycle: median 78m · p90 1.7h (n=7)
- review-check: 2/5 refused (40%) · 8 hard-gate block(s)
- bounce: 0 / 10 reached-review (0%)
- blocked: STORY-029 44.4h (longest)

## Goal verdict
**MET.** 5 of 6 committed stories reached done (STORY-021, 023, 026, 027, 028); the
6th (STORY-029) was closed won't-do by an explicit product decision (reseed/new-session
is synthetic-data-only, no production value) and correctly routed to IDEA-003 — a scope
decision, not a delivery miss. The service-backed client (FEAT-009 resilience/correctness,
latency instrumentation, detail a11y) is substantively complete. Planned enabler work was
not crowded out: the unplanned MarketClient seam (STORY-035) ran *ahead* of the resilience
stories and made store-level tests for 026/027/028 viable.

## Commitment accuracy
First sprint — no prior baseline for trend. Reconstructed from the goal prose (the tooling
read 0/0; see P-1):

| | n | stories |
|---|---|---|
| Committed | 6 | STORY-021, 023, 026, 027, 028, 029 |
| Shipped (of committed) | 5 | 021, 023, 026, 027, 028 |
| Bounced | 0 | — |
| Deferred / closed | 1 | 029 (won't-do → IDEA-003) |
| Unplanned shipped | 5 | 025, 032, 035, 048, 049 |

Unplanned (5) ≈ committed (6): the sprint boundary did not contain scope. Reported, not rewarded.

## Observations
- **Commitment was invisible to the tooling.** `BATCH-001.md` recorded the commitment only
  as prose in the goal; it carries no structured `stories:` field, so `committed_stories()`
  returned `[]` and `sprint-retro` scaffolded `committed: 0 / shipped: 0`, listing all 10
  shipped stories as unplanned. Every future retro authored this way starts from manual
  reconstruction. All four lenses flagged this. → **P-1** (target: `BATCH.template.md` +
  `board.py batch-new`/`sprint-retro`).
- **The 8 hard-gate move blocks were partly false positives from diff-range pollution.** The
  review-check gate diffs `base_commit..HEAD`; when stories are built serially on `main`,
  interleaved `chore(board)` commits and a sibling proxy-fix (`6680c00`) land inside the
  range, flagging in-scope stories as scope violations. STORY-021/027/028 each needed a
  manual override with per-story diff re-verification. Documented as Friction #1 in
  `workflow/docs/workflow-friction-review.md`. → **P-2** (target: `board.py review-check`, scope the
  diff to Touch-scope paths / ignore `backlog/**` + `.workflow/**`).
- **Code-before-story drove the 40% review-check refusal and the demo-sweep flag.** STORY-035
  continued building during its review window (13.6h cycle, 10× median), shipping two extra
  features under its commit label; those were retroactively filed as STORY-048/049, which
  then walked todo→done in <30s (F7 demo-sweep) bypassing ~54 review-check problems because
  the code already existed. Root cause: no DoR rule that a story be in-progress before code
  is written. → **P-3** (target: DoR checklist / `board.py review-check` warning on shared
  `base_commit`).
- **(Gate-3 candidate, not a proposal — in-scope enabler.)** STORY-018 (4 attempts, the
  origin of this whole batch) bounced because its AC named only happy-path async behaviour;
  review found 10 error-state/race regressions, the fix pattern for which became 025/026/027/028.
  An "async error-state + sequencing" AC prompt for any story moving a sync path to a service
  call is SAD-anchorable (SAD#5.9) → feed to the next `/sprint-plan` Gate 3, not the idea inbox.

## Workflow-change proposals
<!-- Top 1–3 frictions as concrete changes to a NAMED artifact (gate/file/
     tool). `board.py sprint-retro --accept P-N` flips status to accepted
     AND spawns an IDEA (capture≠commit); `--reject P-N` flips to rejected. -->

| id  | target (gate/file/tool) | type | status | result |
|-----|-------------------------|------|--------|--------|
| P-1 | `BATCH.template.md` + `board.py batch-new`/`sprint-retro` (structured `stories:` commitment) | tool | accepted | IDEA-004 |
| P-2 | `board.py review-check` (diff Touch-scope paths, ignore `backlog/**`+`.workflow/**`) | tool | accepted | IDEA-005 |
| P-3 | DoR checklist — "story in-progress before code is written" (+ `validate` warn on shared `base_commit`) | process | accepted | IDEA-006 |
