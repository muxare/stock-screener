// dag/kernels/composite.ts — composite (L2+) node-family kernels (SAD-002#5.1, #6.2).
//
// The `macd`/`stochrsi`/`relVol`/`priceVsEma` composite kinds whose inputs include
// L1 aggregations (SAD-002#6.2). This module owns the composite lane of the
// FEAT-014 fan-out; STORY-043 fills it as part of the shared lowering layer
// (SAD-002#5.3). Until then the map is empty: the composite kinds stay reserved
// and evaluating one throws (dag/eval.ts). Kernels here must stay pure and
// dependency-free (SAD-002#5.1) — import only the `Kernel`/`Kernels` types from
// the evaluator, never `market.ts` (that would introduce a `dag/ → market.ts` cycle).
import type { Kernels } from '../eval.ts';

/** Composite (`macd`/`stochrsi`/`relVol`/`priceVsEma`) kernels — reserved until STORY-043. */
export const compositeKernels: Kernels = {};
