---
id: STORY-039
type: story
parent: FEAT-013
capability: CAP-dag-model
sad_refs: [SAD-002#5.1, SAD-002#6.1, SAD-002#6.2, SAD-002#2.6, SAD-002#2.2]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer, I want indicators represented as immutable nodes in an
acyclic graph with derived levels and a structural identity, so that the engine
has an explicit dependency model to share, prune, and schedule computation on.

## Context
First story of SAD-002 / PLAN-002. This is the data model only — no evaluator
(STORY-040), no lowering of real indicators (STORY-043), no operators
(STORY-041/042). It defines the shape every later story builds on: a node is
plain, serialisable data `{ kind, inputs, params }`, level is computed from
inputs, and identity is a pure structural signature generalising today's
`defSig`.

## Acceptance Criteria
- [ ] A node type exists as plain, serialisable data: `{ kind, inputs: NodeRef[],
      params }` per SAD-002#6.1 — no closures/functions stored in a node.
- [ ] The node-kind taxonomy of SAD-002#6.2 is represented: raw-source (L0),
      aggregation, composite, algebraic, relational/boolean, pattern.
- [ ] `level` is a **derived** property (raw sources = 0; every other node =
      `1 + max(level of inputs)`), never hand-assigned (SAD-002#2.6).
- [ ] A test asserts known node shapes resolve to expected levels (e.g. `ema`=1,
      `macd`=2, `relVol`=2) per SAD-002#2.6.
- [ ] Graph construction is asserted **acyclic**; attempting to build a cycle is
      rejected (SAD-002#6.1).
- [ ] Node identity is a pure **structural signature** over `(kind, params, input
      identities)`: equal nodes share a key; any change to kind/params/inputs
      yields a different key (SAD-002#6.1). Identity is instrument-independent.
- [ ] Nodes are immutable after construction (SAD-002#5.1 "avoid mutating nodes").
- [ ] The module stays pure/isomorphic: no import from React/DOM/Node, no
      `fetch`, no global state, no "today" (SAD-002#2.2).

## Architectural Constraints (from SAD)
- Model nodes as plain serialisable data; derive level by walking inputs; keep
  identity a pure function of structure (SAD-002#5.1, SAD-002#6.1). Do NOT store
  closures in nodes, mutate nodes, hand-assign levels, or introduce a cyclic edge.
- Identity generalises the existing `defSig` (SAD-001#6.2) — same structure ⇒ same
  key (dedup), changed structure ⇒ new key (invalidation) (SAD-002#6.1).
- Engine purity is non-negotiable (SAD-002#2.2): if split into a co-located file,
  keep it under the engine and dependency-free.

## Out of scope
- The evaluator and memo cache — STORY-040 (CAP-dag-eval).
- Lowering real `IndicatorDef`s / rules / PCF onto nodes — STORY-043.
- Algebraic and relational node *behaviour* — STORY-041 / STORY-042 (this story
  only reserves their kinds in the taxonomy).
- Any persisted-artifact schema change (SAD-002#6.4 / ADR-007).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/market.ts
- src/lib/dag/**
- src/lib/*.test.ts
