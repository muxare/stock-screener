---
id: STORY-057
type: story
parent: FEAT-014
capability: CAP-algebra
sad_refs: [SAD-002#6.1, SAD-002#5.3, SAD-002#8.4, SAD-002#2.1, SAD-002#2.2]
target: ~
estimate: ~
work_type: feature
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer, I want the DAG to express **bar-offset**, **affine
`×mult/+add` scalars**, and **constant/threshold operands** as evaluable nodes, so
that rule operands (`group`/`chain`/`cond`/`ind`) and PCF can lower onto the DAG
bar-for-bar — the primitive STORY-043 was blocked on.

## Context
Split out of STORY-043 at the Exception gate (2026-07-09). STORY-041 (which absorbed
STORY-042) shipped the algebraic (`+ − × ÷`) and relational (`> < ≥ ≤ == !=`,
`cross_*`) kernels as **pure binary, same-index** folds that ignore `params`. But the
old operand model (`groupOperandVal`, `market.ts:937-945`) is affine-over-offset:
`base(field/ind at bar i − offset) × mult + add`, plus a `{kind:'const', value}`
operand. None of `offset`, the scalar `×mult/+add`, or a constant series is evaluable
as a DAG node today, so rule/preset/PCF lowering (STORY-058) cannot be built. Per
**SAD-002#6.1** a node's `params` already carries `offset` and `mult/add`; this story
makes those params actually evaluate. This is the enabler STORY-058 depends on.

## Acceptance Criteria
- [ ] A constant/threshold operand is expressible as an evaluable DAG node whose
      series is that constant at every (defined) bar — covering `num` thresholds
      (`rsi<38`, `relVol>1.8`, …) and `{kind:'const'}` operands (SAD-002#5.3).
- [ ] A `×mult/+add` affine scalar transform lowers **through the algebraic node
      kinds** (one arithmetic implementation, ADR-004 / SAD-002#8.4) — no second
      arithmetic path — and reproduces `groupOperandVal`'s `base*mult+add` exactly,
      including its `NaN`→identity fallbacks (`market.ts:943-945`).
- [ ] A bar `offset` (0 = current bar, k = k bars ago) is expressible as an evaluable
      node yielding `input[i−k]`, with `i<k` warm-up bars marked `null`, matching the
      old engine's `i − (offset||0)` indexing (`market.ts:937`) (SAD-002#5.3).
- [ ] The primitive is carried as node `params` (`offset`, `mult`, `add`) per
      SAD-002#6.1 — NOT as new node families outside the SAD taxonomy (SAD-002#6.2).
      If the SAD taxonomy genuinely cannot host it as params, STOP and flag it as an
      Architecture-gate/SAD change rather than inventing a node kind.
- [ ] Nodes stay plain, serialisable, immutable, pure/isomorphic; `nodeKey` reflects
      the new params so a changed offset/scalar yields a new identity (SAD-002#5.1,
      SAD-002#6.1, SAD-002#2.2).
- [ ] Unit tests prove offset/affine/const nodes against hand-computed series and,
      where a corresponding old-engine path exists, bar-for-bar over the fixtures
      (SAD-002#2.1).

## Architectural Constraints (from SAD)
- Follow SAD-002#6.1: `params` carries `offset`/`mult`/`add`; level stays derived,
  identity stays structural. Reuse `srcArr` source semantics; preserve offsets and
  arithmetic exactly (SAD-002#5.3). ONE arithmetic implementation (ADR-004).
- Keep kernels pure and dependency-free — import only the `Kernel`/`Kernels`/`Series`
  types, never `market.ts` (no `dag/ → market.ts` cycle) (SAD-002#5.1).
- Bar-for-bar parity is the gate (SAD-002#2.1).

## Out of scope
- Actually lowering the rule operands / PRESETS / PCF onto these primitives — that is
  STORY-058 (this story only makes the primitives evaluable).
- The indicator lowering layer and composite kernels — STORY-043.
- Any persisted def/rule schema change (SAD-002#6.4).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/dag/node.ts                 # honor offset/mult/add params in the model + nodeKey (SAD-002#6.1)
- src/lib/dag/kernels/algebraic.ts    # affine scalar via the algebraic kinds (ADR-004); const/offset primitive
- src/lib/dag/kernels/relational.ts   # scalar-threshold comparison against a param/const (if needed)
- src/lib/dag/node.test.ts            # offset/affine/const node model + identity tests
- src/lib/dag/kernels/algebraic.test.ts   # affine/const kernel parity tests
- src/lib/dag/kernels/relational.test.ts  # threshold-comparison tests
# SAD-aligned design is params on existing nodes (SAD-002#6.1), NOT new node families.
# If a genuine taxonomy change is unavoidable, STOP and flag it (Architecture gate) —
# do NOT edit market.ts's raw/aggregation kernels or DAG_KERNELS assembly.
