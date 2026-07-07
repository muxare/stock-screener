---
id: RETRO-003
type: retro
batch: BATCH-005
created: 2026-07-07
window_start: 2026-07-05
window_end: 2026-07-07T08:02:34.280391+00:00
committed: 5
shipped: 5
---

## Committed vs shipped
- committed: STORY-039, STORY-046, STORY-040, STORY-034, STORY-030  (5)
- shipped:   STORY-039, STORY-046, STORY-040, STORY-034, STORY-030  (5)
- carried:   —  (still open at close)
- unplanned: —  (shipped, not committed)

## Metrics snapshot
- cycle: median 3.7h · p90 4.3h (n=5)
- review-check: 0/1 refused (0%) · 2 hard-gate block(s)
- code-review gate (R-1): 4 block(s) · 2 override(s)
- bounce: 0 / 5 reached-review (0%)
- blocked: none

## Observations
- **Goal MET, cleanly.** The DAG computation core landed with zero consumer-visible change: CAP-dag-model (STORY-039, `src/lib/dag/node.ts`), CAP-dag-eval (STORY-040, `src/lib/dag/eval.ts`, per-node memoisation), CAP-dag-fidelity (STORY-046, live differential + pinned SHA reference). All 5 committed shipped, 0 carried, 0 bounced. The latency clause was proved by a deterministic one-kernel-invocation-per-node assertion (`0e3a228`) rather than a live old-vs-new race — a stronger dedup proof, worth naming as an evidence substitution vs SAD-002#2.5's literal benchmark.
- **The sprint ran fully serial while building the tooling to run in parallel.** Peak actual concurrency was **1** for all 5 stories (each story's `base_commit` is the prior story's board-transition commit — a single linear chain on `main`, never isolated worktrees; `move in-progress` events never overlap). The planned lanes (034∥030 "disjoint throughput", 046 branching off 039) never materialized, and the plan's own "re-run parallelization read on 039 merge (unlocks 040/041/042 split)" trigger never fired — STORY-041/042 sat untouched in `todo`.
- **Shared-branch stacking recurred for a 3rd sprint — the exact failure RETRO-002 predicted.** STORY-040's post-review fix `74ae49d` (see next bullet) landed on the shared branch and made STORY-034/030's already-clean review artifacts stale → 2 review-check hard-gate blocks + 4 R-1 code-review-gate blocks + 2 overrides (12:49–12:52). The overrides were *justified* (each names a verified diff-of-diffs: "reviewed files byte-identical since clean review at …"), not rubber-stamped — but the friction is the mechanism, not the code. `IDEA-005`'s ignorable-paths half is landed; `IDEA-008`'s worktree-isolation half is not, and BATCH-005 *is* the 9-story DAG sprint RETRO-002 warned would re-hit it.
- **New structural gap: the pipeline never exercises `server/`'s module resolution.** STORY-040 shipped browser-style extensionless imports — green under Vite + Vitest (both bundle), but the Node server crashed at startup (`ERR_UNSUPPORTED_DIR_IMPORT`), caught only in review and fixed by `74ae49d`. Root cause is standing, not a fluke: `server/tsconfig.json` (which correctly sets `allowImportingTsExtensions`) is never invoked by `npm run build` (`tsc -b` references only app + node projects) or `npm run test`. Any future server-side import mistake is invisible until a human boots the dev server. New tech-health signal (TH-7 candidate), not in the register.
- **The retro's own metrics are partly corrupted by a tool bug.** `board.py metrics --sprint` computes the `attempts` histogram from `all_stories()` unconditionally (`board.py:3212-3217`), never window-filtered like cycle/bounce are — so "attempts 4×1, 2×2" is **STORY-018/048/049 from earlier work**, not BATCH-005. Every BATCH-005 story is `attempts: 1`; the 0% bounce confirms it. Left unfixed, this misattributes unrelated CAP-screen rework to the DAG capability in every future retro.
- **The fix for the #1 friction landed this window but wasn't adopted.** IDEA-016 (`/refine` + `/fanout` + `board.py combine/retire/fanout`, isolated-worktree lanes with a stamped disjointness proof) merged at the sprint boundary (`0c567c4`) — `test_board_refine.py` passes, the machinery is structurally ready. But no FEAT yet carries `fanout: true`, so `/fanout` has nothing to run on, and IDEA-016 itself is still `status: inbox` with its doc header reading "not landed". Adoption is one prep step short.

## Workflow-change proposals
<!-- Top 1–3 frictions as concrete changes to a NAMED artifact (gate/file/
     tool). `board.py sprint-retro --accept P-N` flips status to accepted
     AND spawns an IDEA (capture≠commit); `--reject P-N` flips to rejected. -->

| id  | target (gate/file/tool) | type | status | result |
|-----|-------------------------|------|--------|--------|
| P-1 | `tsconfig.json` root refs + `package.json` build/test scripts | tooling | accepted | IDEA-017 |
| P-2 | `board.py metrics --sprint` attempts-histogram scoping (`board.py:3212`) | tool | accepted | IDEA-018 |
| P-3 | `board.py sprint-plan-new` — reject bare `note:` prep items with no id | tool | accepted | IDEA-019 |
