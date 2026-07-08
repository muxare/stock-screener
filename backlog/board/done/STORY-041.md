---
id: STORY-041
type: story
parent: FEAT-014
capability: CAP-algebra
sad_refs: [SAD-002#5.1, SAD-002#5.3, SAD-002#2.1]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
combined_from: [STORY-042]
base_commit: 2b71a4d96dbdb5002cc3ba844be724f4d3eb826f
---

## User Story
As an engine developer, I want first-class algebraic combinator nodes
(`+ − × ÷`) and relational/boolean nodes (`> < ≥ ≤ == !=`, `cross_up`/`cross_down`)
that combine scalar series, so that the existing per-operand `×mult/+add`
arithmetic, `hl2`/`hlc3`-style source derivations, and the comparison operators
embedded in the rule evaluators have a single implementation to lower into.

## Context
Depends on the node model (STORY-039). This story now delivers **both** operator
families under FEAT-014 — algebraic and relational/boolean (STORY-042 was combined
into this story; see `combined_from`). These node kinds are the lowering targets for
STORY-043: per ADR-004 (SAD-002#8.4), there is **one** arithmetic implementation and
**one** comparison implementation, not two. No new indicator math — these only
combine existing series (SAD-002#1.2).

## Acceptance Criteria
- [x] `+ − × ÷` exist as first-class node kinds taking scalar-series inputs and
      producing a scalar series (SAD-002#5.1, SAD-002#6.2 "algebraic").
- [x] A node's level is carried by its inputs (`1 + max(level of inputs)`), so an
      algebraic node over L1 inputs is L2, etc. (SAD-002#2.6).
- [x] A composed expression evaluates correctly — e.g. `(EMA18 − EMA50) / <scalar>`
      produces the expected series (SAD-002#3.4).
- [x] Division by zero / null inputs follow the existing engine's null-handling
      semantics exactly (no new NaN/Infinity behaviour) (SAD-002#2.1).
- [x] The `hl2`/`hlc3` source derivations are expressible via these nodes (or
      remain bit-identical), with no second arithmetic path (SAD-002#5.3).
- [x] Nodes stay plain serialisable data, immutable, pure/isomorphic
      (SAD-002#5.1, SAD-002#2.2) — for both algebraic and boolean kinds below.
- [x] (relational) `> < ≥ ≤ == !=` exist as boolean node kinds taking scalar inputs
      and producing a boolean series (SAD-002#5.1, SAD-002#6.2 "relational/boolean").
- [x] (relational) `cross_up` and `cross_down` exist as boolean nodes with the exact
      crossing semantics of the current engine (including the previous-bar comparison
      and null handling) (SAD-002#3.5, SAD-002#2.1).
- [x] (relational) Each comparison/cross operator reproduces the current truth values
      **bar-for-bar** for the operands in `evalCondAt`/`evalChainAt`/`evalIndRuleAt`
      (SAD-002#3.5).
- [x] (relational) Boolean nodes carry level by their scalar inputs (SAD-002#2.6).

## Architectural Constraints (from SAD)
- Make `+ − × ÷` and the comparison/`cross_*` operators first-class node kinds; do
  NOT re-implement arithmetic or comparison differently from these anywhere (single
  source of truth, SAD-002#8.4 / SAD-002#5.3).
- Reproduce the exact existing arithmetic and comparison/cross semantics — the
  harness (STORY-046) gates bar-for-bar equality (SAD-002#2.1).
- Keep nodes immutable, serialisable, dependency-free (SAD-002#5.1, SAD-002#2.2).

## Out of scope
- Lowering the existing `×mult/+add` operands and `cond`/`chain`/`ind` comparison
  operators onto these nodes — STORY-043 (this story delivers the node kinds;
  STORY-043 wires the old operands in).
- Pattern detectors (multi-bar boolean structure) — STORY-044.
- Any temporal/sequencing operator (`THEN`/`WITHIN`/`WHILE…never`) — out of scope
  for the whole plan (SAD-002#1.2).
- Any new indicator type or new math beyond the four algebraic operators and the
  relational/cross operators (SAD-002#1.2).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
<!-- Narrowed from {src/lib/market.ts, src/lib/dag/**, src/lib/*.test.ts} to the
     literal kernel files STORY-056 creates, so 041 is disjoint from {043,044,045,
     056} for the fanout guard. 041 only delivers node kinds into the kernel
     modules; it does NOT edit market.ts (that is 056's spread-merge). -->
<!-- Widened (human-approved, 2026-07-08) to include dag/eval.test.ts: registering
     the algebraic/relational kernels un-reserves `add`/`gt`, so the "reserved kinds
     are firewalled" assertion in eval.test.ts (which STORY-056 deliberately left
     asserting they throw) must drop those two kinds. This update is intrinsic to
     un-reserving them — it belongs to the first story that does so (this one), not a
     parallel lane. It was in the pre-narrow scope (src/lib/dag/**). -->
- src/lib/dag/kernels/algebraic.ts
- src/lib/dag/kernels/relational.ts
- src/lib/dag/kernels/algebraic.test.ts
- src/lib/dag/kernels/relational.test.ts
- src/lib/dag/eval.test.ts
