// dag/kernels/algebraic.ts — algebraic node-family kernels (SAD-002#5.1, #8.4).
//
// The `+ − × ÷` first-class node kinds (SAD-002#6.2, ADR-004 / SAD-002#8.4). This
// module owns the algebraic lane of the FEAT-014 fan-out; STORY-041 fills it.
// Until then the map is empty: the algebraic kinds stay reserved and evaluating
// one throws (dag/eval.ts). Kernels here must stay pure and dependency-free
// (SAD-002#5.1) — import only the `Kernel`/`Kernels` types from the evaluator,
// never `market.ts` (that would introduce a `dag/ → market.ts` cycle).
import type { Kernels } from '../eval.ts';

/** Algebraic (`add`/`sub`/`mul`/`div`) kernels — reserved until STORY-041. */
export const algebraicKernels: Kernels = {};
