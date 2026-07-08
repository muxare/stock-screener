---
id: STORY-056
type: story
parent: FEAT-014
capability: CAP-dag-lower
sad_refs: [SAD-002#5.1, SAD-002#6.2, SAD-002#8.4]
target: ~
estimate: ~
work_type: enabler
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: c0d9fb481ea7b85a1b71f301b87005d3c30fa638
---

## User Story
As an engine developer about to land the algebraic/relational (STORY-041),
composite-lowering (STORY-043), and pattern (STORY-044) node kinds, I want the
single `DAG_KERNELS` object literal split into one module per node-family under
`src/lib/dag/kernels/`, so that each of those stories adds its kernels to its
**own file** instead of all editing the same literal — turning a guaranteed
merge collision into disjoint parallel lanes.

## Context
This is the **contract-first spine** of the FEAT-014 fan-out. Today every
kernel lives in one literal, `DAG_KERNELS` (`src/lib/market.ts:1287-1298`), typed
`Kernels = Readonly<Partial<Record<NodeKind, Kernel>>>` (`src/lib/dag/eval.ts:52`)
and consumed by the data-driven evaluator (`eval.ts:104`, `kernels[target.kind]` —
a missing kind throws as *reserved*). Because dispatch is data-driven, registering
a kind means adding a map entry and **nothing in `eval.ts` changes**. The problem
is purely that the four downstream stories would all edit the *same literal in the
same file*. Extracting the literal into per-family modules and re-composing it via
spread-merge in `market.ts` gives each downstream story an isolated file to own.

This is a **behaviour-preserving refactor**: the reserved algebraic / relational /
composite / pattern kinds stay reserved (their modules start empty); no new
node-kind behaviour is added here. Per **ADR-004 (SAD-002#8.4)** the kernel table is
the single source of truth for operator implementations — this story only re-homes
it without changing what it resolves to.

## Acceptance Criteria
- [x] A `src/lib/dag/kernels/` directory exists with **one module per reserved
      node-family** the fan-out needs to own disjointly: `algebraic.ts`,
      `relational.ts` (both later filled by STORY-041), `composite.ts` (STORY-043),
      and `pattern.ts` (STORY-044). Each exports a `Kernels`-typed map
      (`Partial<Record<NodeKind, Kernel>>` per `SAD-002#5.1`), initially **empty**
      (the reserved kinds remain reserved — evaluating one still throws).
- [x] `DAG_KERNELS` in `src/lib/market.ts` is rebuilt as a **spread-merge** of the
      per-family maps, e.g.
      `{ ...rawSourceKernels, ...aggregationKernels, ...algebraicKernels, ...relationalKernels, ...compositeKernels, ...patternKernels }`,
      and its exported type/shape is unchanged (`SAD-002#5.1`, `SAD-002#6.2`).
- [x] `DAG_KERNELS` resolves to the **identical kernel set** as before this story:
      the same registered kinds (`open/high/low/close/volume/hl2/hlc3` +
      `ema/sma/rsi`) map to the same functions; the reserved kinds are still absent.
- [x] The whole existing suite stays green **unchanged** — in particular
      `src/lib/fidelity.test.ts` (bar-for-bar parity) and `src/lib/dag/eval.test.ts`
      pass without edits, proving behaviour preservation (`SAD-002#2.3`).
- [x] The `src/lib/dag/` modules stay **pure, dependency-free, and isomorphic**
      (`SAD-002#2.2`, `SAD-002#5.1`): no import cycle is introduced between
      `market.ts` and `src/lib/dag/kernels/**` (see Constraints).
- [x] `npm run lint` and `npm run test` pass.

## Architectural Constraints (from SAD)
- **One kernel table, re-homed not rewritten (ADR-004 / SAD-002#8.4).** Keep the
  kernel map the single source of truth for operators; do not fork a second
  implementation or change any kernel's math. This story moves the literal only.
- **Node kinds stay reserved (SAD-002#6.2).** The `algebraic`/`relational`/
  `composite`/`pattern` modules ship **empty**; do not implement those kinds here —
  that is STORY-041/043/044's work. Evaluating a reserved kind must still throw.
- **`src/lib/dag/` must stay dependency-free (SAD-002#5.1).** The evaluator core is
  pure and isomorphic. If a per-family kernel module needs pure math currently in
  `market.ts` (e.g. `ema`/`sma`/`rsi`, `RAW_SOURCE`), **do not** import `market.ts`
  from `dag/` (that would create a cycle, since `market.ts` imports `dag/`). Either
  keep the raw-source and aggregation kernels composed in `market.ts` (only the four
  reserved-family modules need to live under `dag/kernels/` to unblock the fan-out),
  or move the pure helpers down into `dag/` alongside the kernels — never introduce a
  `dag/ → market.ts` edge.
- **Data-driven dispatch is unchanged (SAD-002#5.2).** Do not touch `eval.ts`'s
  dispatch; registration is by presence in the map, so no `eval.ts` edit is needed.

## Out of scope
- Implementing any reserved node kind — algebraic/relational (STORY-041),
  composite lowering (STORY-043), pattern (STORY-044). This story leaves them
  reserved and only creates the seam.
- Any change to the evaluator machinery, the node model, or `eval.ts` dispatch.
- Touching the entry-point functions (`indSeries`/`eval*`/`backtestRules`) —
  that is STORY-045's closing-link rewrite (SAD-002#5.4).
- Editing `src/lib/dag/index.ts` — leave the barrel export to STORY-047, which
  owns that file in its independent lane. Kernel modules are imported by path, so
  no barrel re-export is needed here; adding one would collide with 047.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. This is a behaviour-preserving refactor: prove it by keeping
> `src/lib/fidelity.test.ts` and `src/lib/dag/eval.test.ts` green **without
> editing them**. Do NOT implement any reserved node kind, do NOT create a
> `dag/ → market.ts` import cycle, and do NOT edit `src/lib/dag/index.ts` (STORY-047
> owns it — import kernel modules by path instead). Stay within "Touch scope". Add
> nothing beyond the acceptance criteria; if a requirement conflicts with the SAD,
> STOP and flag it.

## Touch scope
<!-- Deliberately does NOT touch src/lib/dag/index.ts: STORY-047 owns the single
     barrel-export line there, and taking it here would collide with 047's
     independent lane. Downstream stories import the kernel modules by path; no
     barrel re-export is needed to unblock the fan-out. -->
- src/lib/market.ts               # the spread-merge edit + any pure helpers moved down
- src/lib/dag/kernels/**          # new per-family kernel modules
