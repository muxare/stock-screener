// dag/kernels/algebraic.ts — algebraic node-family kernels (SAD-002#5.1, #8.4).
//
// The `+ − × ÷` first-class node kinds (SAD-002#6.2, ADR-004 / SAD-002#8.4). This
// module owns the algebraic lane of the FEAT-014 fan-out (STORY-041). Per ADR-004
// there is ONE arithmetic implementation: these element-wise combinators are the
// lowering target for the existing per-operand `×mult/+add` and `hl2`/`hlc3`
// derivations (STORY-043 wires them in). Kernels here stay pure and dependency-free
// (SAD-002#5.1) — they import only the `Kernel`/`Kernels`/`Series` types from the
// evaluator, never `market.ts` (that would introduce a `dag/ → market.ts` cycle).
import type { Kernels, Series } from '../eval.ts';

/** Binary element-wise op on two defined numbers; `null` marks an undefined result. */
type BinOp = (a: number, b: number) => number | null;

/**
 * Fold the input series element-wise with `op`, left-to-right, one output value per
 * bar. Null/`NaN` propagate: at any bar where an operand (or an intermediate result)
 * is null or `NaN`, the output is `null`. This mirrors the engine's existing scalar
 * null-handling (`groupOperandVal` returns `null` on a null/`NaN` operand,
 * SAD-002#2.1) and, together with `div`'s zero-guard, guarantees no new
 * `NaN`/`Infinity` ever enters a series (AC: "no new NaN/Infinity behaviour").
 */
function foldElementwise(inputs: readonly Series[], op: BinOp): Series {
  const len = inputs.length ? inputs[0].length : 0;
  const out: (number | null)[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const first = inputs[0][i];
    let acc: number | null = first == null || Number.isNaN(first) ? null : first;
    for (let k = 1; k < inputs.length && acc != null; k++) {
      const v = inputs[k][i];
      acc = v == null || Number.isNaN(v) ? null : op(acc, v);
      if (acc != null && Number.isNaN(acc)) acc = null;
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Algebraic (`add`/`sub`/`mul`/`div`) kernels over scalar-series inputs, producing a
 * scalar series (SAD-002#6.2 "algebraic"). Each folds its inputs element-wise, so a
 * node carries whatever level its inputs imply (`1 + max(level)`, SAD-002#2.6) — the
 * kernel is level-agnostic. `div` maps a zero divisor to `null` rather than emitting
 * `Infinity`/`NaN`, keeping the series within the engine's undefined-marker
 * semantics (SAD-002#2.1).
 */
export const algebraicKernels: Kernels = {
  add: (inputs) => foldElementwise(inputs, (a, b) => a + b),
  sub: (inputs) => foldElementwise(inputs, (a, b) => a - b),
  mul: (inputs) => foldElementwise(inputs, (a, b) => a * b),
  div: (inputs) => foldElementwise(inputs, (a, b) => (b === 0 ? null : a / b)),
};
