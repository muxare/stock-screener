---
id: BATCH-005
type: batch
status: active
created: 2026-07-05
wip_limit: 4
capabilities: [CAP-dag-model, CAP-dag-eval, CAP-dag-fidelity, CAP-screen]
stories: [STORY-039, STORY-046, STORY-040, STORY-034, STORY-030]
---

## Goal
The engine gains an explicit computation core: an immutable, acyclic, leveled node model (CAP-dag-model) and a topological, memoising evaluator over it (CAP-dag-eval), pinned by a fidelity harness (CAP-dag-fidelity) — zero consumer-visible change, no latency regression.

## Capabilities committed
- CAP-dag-model
- CAP-dag-eval
- CAP-dag-fidelity
- CAP-screen

## Stories committed
- STORY-039 — <why it's in this sprint>
- STORY-046 — <why it's in this sprint>
- STORY-040 — <why it's in this sprint>
- STORY-034 — <why it's in this sprint>
- STORY-030 — <why it's in this sprint>

## Execution strategy
039(A1) spine-head isolated worktree first; 034+030 disjoint throughput lanes concurrent; 046 branches off 039 at review; 040 opens only after 039 merges, review-gated on 046 green; 038/019/055 deferred; re-run parallelization read on 039 merge

## Preparation / enablers
- idea:008
- note:re-run /sprint-plan parallelization read when STORY-039 merges (unlocks 040/041/042 split)
- note:gate STORY-040 review on STORY-046 harness green

## Notes
