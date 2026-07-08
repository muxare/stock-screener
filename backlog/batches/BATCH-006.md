---
id: BATCH-006
type: batch
status: active
created: 2026-07-08
wip_limit: 3
capabilities: [CAP-dag-lower, CAP-algebra, CAP-pattern-nodes, CAP-dag-compat, CAP-dag-schedulable]
stories: [STORY-056, STORY-041, STORY-043, STORY-044, STORY-045, STORY-047]
---

## Goal
Close EPIC-005: every reserved DAG node kind (algebraic, relational, composite-lowering, pattern) implemented and reachable through the unchanged public engine surface, bar-for-bar identical over fixtures (SAD-002#2.1)

## Capabilities committed
- CAP-dag-lower
- CAP-algebra
- CAP-pattern-nodes
- CAP-dag-compat
- CAP-dag-schedulable

## Stories committed
- STORY-056 — <why it's in this sprint>
- STORY-041 — <why it's in this sprint>
- STORY-043 — <why it's in this sprint>
- STORY-044 — <why it's in this sprint>
- STORY-045 — <why it's in this sprint>
- STORY-047 — <why it's in this sprint>

## Execution strategy
Spine 056→041→{043∥044 via /fanout}→045; 047 independent lane; WIP 3; tier A2; reviewer fan-out on 043/045; 056 skips dag/index.ts barrel so 047 owns it

## Preparation / enablers
- story:STORY-056
- note:pattern-kernel spike before Stage 1 closes
- note:fix board.py cmd_combine multi-line AC truncation
- note:add dag→market.ts import-boundary check to run_review_check

## Notes
