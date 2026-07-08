// dag/kernels/pattern.ts — pattern node-family kernels (SAD-002#5.1, #8.5).
//
// Boolean multi-bar structure detectors over raw + indicator inputs (SAD-002#6.2,
// ADR-005 / SAD-002#8.5). This module owns the pattern lane of the FEAT-014
// fan-out; STORY-044 fills it. Until then the map is empty: the pattern kind stays
// reserved and evaluating one throws (dag/eval.ts). Kernels here must stay pure and
// dependency-free (SAD-002#5.1) — import only the `Kernel`/`Kernels` types from the
// evaluator, never `market.ts` (that would introduce a `dag/ → market.ts` cycle).
import type { Kernels } from '../eval.ts';

/** Pattern (boolean multi-bar detector) kernels — reserved until STORY-044. */
export const patternKernels: Kernels = {};
