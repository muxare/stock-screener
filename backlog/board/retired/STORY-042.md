---
id: STORY-042
type: story
parent: FEAT-014
capability: CAP-relational
sad_refs: [SAD-002#5.1, SAD-002#5.3, SAD-002#2.1]
target: ~
estimate: ~
attempts: 0
prev_column: todo
blocked_reason: ~
reject_reason: ~
retired_reason: combined into STORY-041
combined_into: STORY-041
---

## User Story
As an engine developer, I want first-class relational/boolean nodes
(`> < ≥ ≤ == !=`, `cross_up`/`cross_down`) that consume scalar nodes, so that the
comparison operators currently embedded in `cond`/`chain`/`ind` evaluators have a
single implementation to lower into.

## Context
Depends on the node model (STORY-039). The boolean sibling of STORY-041. These
are the lowering targets for the comparison/cross operators inside `evalCondAt`/
`evalChainAt`/`evalIndRuleAt` (ADR-004, SAD-002#8.4). Truth values must match the
current engine bar-for-bar (the POC parity, SAD-002#3.5).

## Acceptance Criteria
- [ ] `> < ≥ ≤ == !=` exist as boolean node kinds taking scalar inputs and
      producing a boolean series (SAD-002#5.1, SAD-002#6.2 "relational/boolean").
- [ ] `cross_up` and `cross_down` exist as boolean nodes with the exact
      crossing semantics of the current engine (including the previous-bar
      comparison and null handling) (SAD-002#3.5, SAD-002#2.1).
- [ ] Each comparison/cross operator reproduces the current truth values
      **bar-for-bar** for the operands in `evalCondAt`/`evalChainAt`/
      `evalIndRuleAt` (SAD-002#3.5).
- [ ] Boolean nodes carry level by their scalar inputs (SAD-002#2.6).
- [ ] Nodes stay plain serialisable data, immutable, pure/isomorphic
      (SAD-002#5.1, SAD-002#2.2).

## Architectural Constraints (from SAD)
- Make comparisons and `cross_*` first-class boolean node kinds; do NOT keep a
  second comparison implementation inside the rule evaluators (single source of
  truth, SAD-002#8.4 / SAD-002#5.3).
- Reproduce exact existing comparison/cross semantics — gated bar-for-bar by the
  harness (STORY-046, SAD-002#2.1).
- Keep nodes immutable, serialisable, dependency-free (SAD-002#5.1, SAD-002#2.2).

## Out of scope
- Lowering the existing `cond`/`chain`/`ind` operators onto these nodes —
  STORY-043 (this story delivers the node kinds).
- Algebraic operators — STORY-041.
- Pattern detectors (multi-bar boolean structure) — STORY-044.
- Any temporal/sequencing operator (`THEN`/`WITHIN`/`WHILE…never`) — out of
  scope for the whole plan (SAD-002#1.2).

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
