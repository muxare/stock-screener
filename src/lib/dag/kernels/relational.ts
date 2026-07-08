// dag/kernels/relational.ts — relational/boolean node-family kernels (SAD-002#5.1, #8.4).
//
// The `> < ≥ ≤ == !=` and `cross_up`/`cross_down` first-class node kinds with
// boolean output (SAD-002#6.2, ADR-004 / SAD-002#8.4). This module owns the
// relational lane of the FEAT-014 fan-out (STORY-041). Per ADR-004 there is ONE
// comparison implementation: these kernels reproduce, bar-for-bar, the comparison
// and cross semantics embedded today in `evalCondAt`/`evalChainAt`/`evalIndRuleAt`
// (SAD-002#3.5) and are the lowering target STORY-043 wires those operators into.
// Kernels stay pure and dependency-free (SAD-002#5.1) — they import only the
// `Kernels`/`Series` types from the evaluator, never `market.ts`.
//
// Boolean output is encoded in the numeric `Series` (`number | null`) as `1` = true
// and `0` = false. The engine's comparison evaluators never return null — a null/NaN
// operand yields `false` (e.g. `evalCondAt` returns false on any null/NaN operand) —
// so these kernels emit `0` (not null) at such bars, reproducing that truth value
// exactly. There are no nulls in a boolean series.
import type { Kernels, Series } from '../eval.ts';

/** True iff both operands are defined (non-null, non-`NaN`). */
function defined(a: number | null, b: number | null): boolean {
  return a != null && b != null && !Number.isNaN(a) && !Number.isNaN(b);
}

/** A comparison on two defined numbers. */
type Cmp = (a: number, b: number) => boolean;

/**
 * Compare the two input series element-wise, producing a boolean series (`1`/`0`).
 * A null/`NaN` operand yields `0` (false), matching the engine's evaluators
 * (SAD-002#3.5, #2.1). Consumes exactly two scalar inputs (left, right).
 */
function compareElementwise(inputs: readonly Series[], cmp: Cmp): Series {
  const L = inputs[0] ?? [];
  const R = inputs[1] ?? [];
  const out: (number | null)[] = new Array(L.length);
  for (let i = 0; i < L.length; i++) {
    const a = L[i];
    const b = R[i];
    out[i] = defined(a, b) && cmp(a as number, b as number) ? 1 : 0;
  }
  return out;
}

/**
 * The engine's crossing test (`evalCondAt`/`evalIndRuleAt`): a cross at bar `i`
 * requires `i ≥ 1` and BOTH the current and previous-bar operands defined; then
 * `cross_up` is `prev.left ≤ prev.right ∧ left > right`, `cross_down` the mirror.
 * Any of `{a,b,prevA,prevB}` null/`NaN`, or `i < 1`, yields `0` (SAD-002#3.5, #2.1).
 */
function crossElementwise(inputs: readonly Series[], up: boolean): Series {
  const L = inputs[0] ?? [];
  const R = inputs[1] ?? [];
  const out: (number | null)[] = new Array(L.length);
  for (let i = 0; i < L.length; i++) {
    if (i < 1) {
      out[i] = 0;
      continue;
    }
    const a = L[i];
    const b = R[i];
    const pa = L[i - 1];
    const pb = R[i - 1];
    if (!defined(a, b) || !defined(pa, pb)) {
      out[i] = 0;
      continue;
    }
    const crossed = up
      ? (pa as number) <= (pb as number) && (a as number) > (b as number)
      : (pa as number) >= (pb as number) && (a as number) < (b as number);
    out[i] = crossed ? 1 : 0;
  }
  return out;
}

/**
 * Approximate equality, reproduced bit-for-bit from the engine's `eq` operator
 * (`evalCondAt`): equal within the larger of an absolute floor (`1e-9`) and a
 * relative tolerance (`0.0015 × |b|`). Kept as the single source of truth so both
 * `eq` and `neq` share one definition (ADR-004).
 */
const approxEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.0015);

/**
 * Relational (`gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`cross_*`) kernels over two scalar
 * inputs, producing a boolean series (SAD-002#6.2 "relational/boolean"). Level is
 * carried by the inputs (`1 + max(level)`, SAD-002#2.6) — the kernels are
 * level-agnostic. `gt/lt/gte/lte/eq/cross_*` reproduce the engine's truth values
 * bar-for-bar; `neq` has no engine counterpart and is defined as the logical
 * complement of `eq`'s approximate equality (single source of truth, ADR-004).
 */
export const relationalKernels: Kernels = {
  gt: (inputs) => compareElementwise(inputs, (a, b) => a > b),
  lt: (inputs) => compareElementwise(inputs, (a, b) => a < b),
  gte: (inputs) => compareElementwise(inputs, (a, b) => a >= b),
  lte: (inputs) => compareElementwise(inputs, (a, b) => a <= b),
  eq: (inputs) => compareElementwise(inputs, approxEqual),
  neq: (inputs) => compareElementwise(inputs, (a, b) => !approxEqual(a, b)),
  cross_up: (inputs) => crossElementwise(inputs, true),
  cross_down: (inputs) => crossElementwise(inputs, false),
};
