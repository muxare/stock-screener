---
id: STORY-041
type: story
parent: FEAT-014
capability: CAP-algebra
sad_refs: [SAD-002#5.1, SAD-002#5.3, SAD-002#2.1]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer, I want first-class algebraic combinator nodes
(`+ − × ÷`) that combine scalar series, so that the existing per-operand
`×mult/+add` arithmetic and `hl2`/`hlc3`-style source derivations have a single
implementation to lower into.

## Context
Depends on the node model (STORY-039). One of the two operator stories under
FEAT-014 (relational is STORY-042). These node kinds are the lowering targets for
STORY-043: per ADR-004 (SAD-002#8.4), there is **one** arithmetic implementation,
not two. No new indicator math — these only combine existing series
(SAD-002#1.2).

## Acceptance Criteria
- [ ] `+ − × ÷` exist as first-class node kinds taking scalar-series inputs and
      producing a scalar series (SAD-002#5.1, SAD-002#6.2 "algebraic").
- [ ] A node's level is carried by its inputs (`1 + max(level of inputs)`), so an
      algebraic node over L1 inputs is L2, etc. (SAD-002#2.6).
- [ ] A composed expression evaluates correctly — e.g. `(EMA18 − EMA50) / <scalar>`
      produces the expected series (SAD-002#3.4).
- [ ] Division by zero / null inputs follow the existing engine's null-handling
      semantics exactly (no new NaN/Infinity behaviour) (SAD-002#2.1).
- [ ] The `hl2`/`hlc3` source derivations are expressible via these nodes (or
      remain bit-identical), with no second arithmetic path (SAD-002#5.3).
- [ ] Nodes stay plain serialisable data, immutable, pure/isomorphic
      (SAD-002#5.1, SAD-002#2.2).

## Architectural Constraints (from SAD)
- Make `+ − × ÷` first-class node kinds; do NOT re-implement arithmetic
  differently from these anywhere (single source of truth, SAD-002#8.4 /
  SAD-002#5.3).
- Reproduce the exact existing arithmetic semantics — the harness (STORY-046)
  gates bar-for-bar equality (SAD-002#2.1).
- Keep nodes immutable, serialisable, dependency-free (SAD-002#5.1, SAD-002#2.2).

## Out of scope
- Lowering the existing `×mult/+add` operands onto these nodes — STORY-043
  (this story delivers the node kinds; STORY-043 wires the old operands in).
- Relational/boolean operators — STORY-042.
- Any new indicator type or new math beyond the four operators (SAD-002#1.2).

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
