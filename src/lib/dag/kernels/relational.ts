// dag/kernels/relational.ts — relational/boolean node-family kernels (SAD-002#5.1, #8.4).
//
// The `> < ≥ ≤ == !=` and `cross_up`/`cross_down` first-class node kinds with
// boolean output (SAD-002#6.2, ADR-004 / SAD-002#8.4). This module owns the
// relational lane of the FEAT-014 fan-out; STORY-041 fills it. Until then the map
// is empty: the relational kinds stay reserved and evaluating one throws
// (dag/eval.ts). Kernels here must stay pure and dependency-free (SAD-002#5.1) —
// import only the `Kernel`/`Kernels` types from the evaluator, never `market.ts`.
import type { Kernels } from '../eval.ts';

/** Relational (`gt`/`lt`/…/`cross_*`) kernels — reserved until STORY-041. */
export const relationalKernels: Kernels = {};
