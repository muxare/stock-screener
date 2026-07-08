---
id: STORY-047
type: story
parent: FEAT-017
capability: CAP-dag-schedulable
sad_refs: [SAD-002#5.6, SAD-002#2.4, SAD-002#1.2]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer preparing for server-side materialisation and the deferred
temporal layer, I want a small, stable, read-only surface exposing the DAG's
topological ordering and a per-(node, bar) value accessor, so that lower levels
can later be materialised once and pruned — without building any server here.

## Context
Depends on the evaluator (STORY-040). Per ADR-008 (SAD-002#8.8), this delivers
the *enabling contract only*: the topological order + addressable per-(node, bar)
values that the screening service (`SAD-001#4.2`) and the deferred temporal layer
will sit on. Explicitly **no** server/transport/materialisation code
(SAD-002#1.2). This is the one designed seam for forward-compatibility
(SAD-002#7).

## Acceptance Criteria
- [ ] The engine exposes a **stable topological ordering** of a DAG as read-only
      output (SAD-002#5.6, SAD-002#3.9).
- [ ] The engine exposes a **per-(node, bar) value accessor** (addressable node
      values) as read-only output (SAD-002#5.6, SAD-002#3.9).
- [ ] A documented example shows lower-level nodes computed **independently of any
      single rule** (SAD-002#3.9, SAD-002#2.4).
- [ ] The contract is documented (the stable shape of the ordering + accessor)
      (SAD-002#5.6).
- [ ] **No** server, transport, or materialisation code is added (SAD-002#1.2,
      SAD-002#8.8).
- [ ] No instrument I/O leaks into the engine; the surface is pure/isomorphic
      (SAD-002#2.2, SAD-002#5.6).

## Architectural Constraints (from SAD)
- Expose ordering + addressable node values as **read-only** engine output;
  document the contract (SAD-002#5.6). Do NOT bake any server/transport/
  materialisation decision into the engine, and do NOT leak instrument I/O into
  it (SAD-002#1.2, SAD-002#2.2).
- This is the seam the deferred temporal layer and server materialisation will
  use; other components must not assume a flat series model (SAD-002#7 / ADR-006).

## Out of scope
- Any actual server-side materialisation / precompute store — the `SAD-001#2.5`
  follow-through, explicitly out (SAD-002#1.2, SAD-002#8.8).
- The temporal sequencing layer itself (`THEN`/`WITHIN`/`WHILE…never`/onset) —
  deferred follow-on (SAD-002#1.2 / ADR-006); this only reserves its seam.
- Any transport/serialisation-format decision for shipping the DAG to a server.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/dag/schedule.ts        # new: read-only schedulability surface (stable topo order + per-(node,bar) accessor)
- src/lib/dag/index.ts           # one barrel-export line for the new surface
- src/lib/dag/schedule.test.ts   # new: the surface's own tests
# Narrowed from {src/lib/market.ts, src/lib/dag/**, src/lib/*.test.ts} (/refine, this
# ceremony): the deliverable is additive read-only surface over machinery STORY-040
# already built — EvalStats.computed (bottom-up topological order) + the per-node cache
# in src/lib/dag/eval.ts are already public, so this consumes them without touching
# market.ts, the DAG_KERNELS region, eval.ts, or the shared fidelity.test.ts. This
# lifts STORY-047 out of the engine-chain collision set → independent parallel lane.
