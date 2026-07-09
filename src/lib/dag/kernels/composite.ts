// dag/kernels/composite.ts — composite (L2+) node-family kernels (SAD-002#5.1, #6.2).
//
// The `macd`/`stochrsi`/`relVol`/`priceVsEma` composite kinds whose inputs include
// L1 aggregations (SAD-002#6.2). This module owns the composite lane of the
// FEAT-014 fan-out; STORY-043 fills it as part of the shared lowering layer
// (SAD-002#5.3). Until then the map is empty: the composite kinds stay reserved
// and evaluating one throws (dag/eval.ts). Kernels here must stay pure and
// dependency-free (SAD-002#5.1) — import only the `Kernel`/`Kernels` types from
// the evaluator, never `market.ts` (that would introduce a `dag/ → market.ts` cycle).
import type { Kernels, Series } from '../eval.ts';

/**
 * The composite `stochrsi` kernel: the rolling stochastic normalisation of an RSI
 * series (STORY-043). This is the ONE piece of the stochrsi lowering that is not
 * graph-expressible — a rolling min/max over a window is not an element-wise fold of
 * existing kinds. The %K/%D smoothing that follows it stays plain `sma` graph nodes
 * (see dag/lower.ts), so this kernel reproduces exactly the pre-smoothing `stoch`
 * array of the engine's `stochRsi` (market.ts) bar-for-bar (SAD-002#2.1):
 *
 *   - the first `period` bars are `null` (warm-up), matching the engine;
 *   - each later bar normalises the input to `((r[i] - lo) / (hi - lo)) * 100` over
 *     the trailing `period`-bar window, with a flat window (`hi === lo`) mapping to 0.
 *
 * `params.period` is the stoch length. The single input is the RSI series; the
 * engine feeds `stochRsi` a fully-defined `rsi(...)` array, so the values read here
 * are numbers. Pure and dependency-free (SAD-002#5.1): imports only evaluator types.
 */
const stochrsiNormalise: Kernels['stochrsi'] = (inputs, params) => {
  const r = inputs[0];
  const period = +(params.period as number);
  const out: (number | null)[] = new Array(r.length).fill(null);
  for (let i = 0; i < r.length; i++) {
    if (i < period) {
      out[i] = null;
      continue;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const v = r[j] as number;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[i] = hi === lo ? 0 : (((r[i] as number) - lo) / (hi - lo)) * 100;
  }
  return out as Series;
};

/**
 * Composite (L2+) kernels (SAD-002#6.2). Only `stochrsi` is registered here: `macd`
 * is graph-lowered (ema + algebraic `sub`) so it needs no kernel and stays reserved,
 * and `relVol`/`priceVsEma` are operand-level composites (STORY-058), not
 * `IndicatorDef` types, so they remain reserved (empty) until then. `compositeKernels`
 * is spread into `DAG_KERNELS` (market.ts), so registering `stochrsi` here lights it
 * up with no engine edit.
 */
export const compositeKernels: Kernels = {
  stochrsi: stochrsiNormalise,
};
