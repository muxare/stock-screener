---
id: STORY-043
type: story
parent: FEAT-014
capability: CAP-dag-lower
sad_refs: [SAD-002#5.3, SAD-002#5.1, SAD-002#6.4, SAD-002#2.1]
target: ~
estimate: ~
attempts: 2
blocked_reason: ~
base_commit: f98d923be39ce05dfa02c556c6cfb9f804c029a0
---

## User Story
As an engine developer, I want every existing `IndicatorDef` to lower onto DAG nodes
through one shared lowering layer, so that indicator evaluation runs through the DAG
bar-for-bar identical to the current engine and cannot diverge.

## Context
**Re-scoped at the Exception gate (2026-07-09).** The original STORY-043 also covered
lowering rule operands / PRESETS / PCF, but that needs the offset/affine/const
lowering primitive which did not exist (`groupOperandVal`, `market.ts:937-945`; the
algebraic/relational kernels are pure binary same-index folds). That primitive is now
**STORY-057** and the operand/preset/PCF lowering is **STORY-058** (depends on 057 +
this story). This story keeps the doable-now half: the **indicator** lowering layer
and composite kernels, plus rerouting the macd/stochrsi fidelity subjects to live.

Depends on the node model (STORY-039) and the algebraic nodes (STORY-041). Persisted
def JSON is unchanged and lowered at evaluation time (SAD-002#6.4). Parity is the gate.

## Acceptance Criteria
- [x] Every existing `IndicatorDef` type (`ema`, `sma`, `rsi`, `macd`, `stochrsi`,
      `price`) lowers to a DAG that evaluates **bar-for-bar identical** to the
      current engine (SAD-002#3.2, SAD-002#2.1).
- [x] `macd`/`priceVsEma`/`relVol` lower as **graphs of existing kinds** (ema/sma +
      algebraic add/sub/mul/div) where possible; a genuine composite **kernel** is
      added only where the math is not graph-expressible (e.g. stochrsi's rolling
      min/max of RSI). No arithmetic is re-implemented differently (ADR-004).
- [x] `srcArr` source semantics (close/open/high/low/hl2/hlc3/volume) are reused as
      raw-source node kinds, not re-derived differently (SAD-002#5.3).
- [x] The `fidelity.test.ts` `ind:macd:*` and `ind:stochrsi:*` subjects move from the
      pinned reference to the LIVE old-vs-new differential (lower def → `evalDagNode`
      vs `indSeries`, bar-for-bar over the universe); coverage is not weakened. The
      `preset:*`/`pcf:*` subjects stay pinned until STORY-058.
- [x] Persisted `IndicatorDef` JSON shapes are **unchanged**; lowering happens at
      evaluation time with no saved-artifact migration (SAD-002#6.4).
- [x] Lowering functions are pure and isomorphic (SAD-002#2.2).

## Architectural Constraints (from SAD)
- One lowering path for indicators; reuse `srcArr` source semantics; preserve
  arithmetic exactly (SAD-002#5.3). Composite kernels stay pure and dependency-free —
  import only the `Kernel`/`Kernels`/`Series` types, never `market.ts` (no
  `dag/ → market.ts` cycle).
- No persisted-artifact schema change or migration in this scope (SAD-002#6.4 /
  ADR-007).
- Bar-for-bar parity is the gate, via the fidelity harness (SAD-002#2.1).

## Out of scope
- Rule operand / PRESETS / PCF lowering — **STORY-058** (needs the STORY-057 primitive).
- The offset/affine/const lowering primitive — **STORY-057**.
- The algebraic / relational node kinds themselves — STORY-041.
- Changing the public `indSeries`/`eval*` signatures — STORY-045.
- Any persisted def/rule schema change or migration (SAD-002#6.4).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/dag/lower.ts             # new: shared lowering layer (IndicatorDef → nodes, SAD-002#5.3)
- src/lib/dag/lower.test.ts        # new: indicator lowering unit tests
- src/lib/dag/kernels/composite.ts # fill composite kernels (stochrsi; relVol/priceVsEma as needed)
- src/lib/fidelity.test.ts         # reroute ONLY ind:macd:*/ind:stochrsi:* pinned → live-differential
- src/lib/dag/eval.test.ts         # AMENDED (Exception gate 2026-07-09): shared reserved-kinds firewall test — if a stochrsi composite kernel is added it un-reserves `stochrsi`, so drop ONLY that case. Shared with STORY-044 (un-reserves pattern); this lane branches from the post-044 merge so it edits eval.test.ts on top of 044's change (no conflict).
# Do NOT edit src/lib/market.ts: build lowering as new pure functions under dag/,
# mapping def.source → raw-source kinds (reuse, don't re-derive hl2/hlc3). compositeKernels
# is already spread into DAG_KERNELS, so filling composite.ts lights it up with no market.ts
# edit. Leave preset:*/pcf:* fidelity subjects pinned (STORY-058 reroutes them). If indicator
# lowering genuinely cannot avoid a market.ts edit, STOP and flag it rather than expanding scope.
