// dag/pattern.ts — lowering of price-action patterns to boolean DAG nodes
// (STORY-044, ADR-005 / SAD-002#8.5).
//
// Per ADR-005 (SAD-002#8.5) a price-action pattern is a boolean DAG node consuming
// raw + indicator-level inputs — it composes in the same calculus as every other
// node while keeping the exact `evalPatternAt` (SAD-001#3.7) truth values. This
// module is the LOWERING only: given a pattern name and its lookback `n`, it builds
// an immutable `pattern` node whose inputs are the raw OHLC sources it reads (plus
// RSI(14) for the RSI-divergence detectors) and whose params carry `{ pat, n }`. The
// per-bar detection math lives in the pure `pattern` kernel (dag/kernels/pattern.ts),
// which the evaluator dispatches by `params.pat` — so pattern flags are computed,
// memoised, and pruned through the ordinary evaluator, with no per-bar pattern cache.
//
// Purity is non-negotiable (SAD-002#2.2): this module imports ONLY the node model.
// It never imports `market.ts` (that would introduce a `dag/ → market.ts` cycle) —
// `market.ts` is used solely as the parity ORACLE in the sibling test, never here.
import { node, source, type Node } from './node.ts';

// Raw OHLC sources, shared across every lowered pattern node (structural dedup via
// nodeKey means these frozen singletons collapse to one cache entry each).
const OPEN = source('open');
const HIGH = source('high');
const LOW = source('low');
const CLOSE = source('close');

// The RSI period the engine's divergence detectors read (`rsi(stock.full.c, 14)` in
// evalPatternAt via ensureRsiBT). The DAG `rsi` kernel reuses the SAME `rsi` math, so
// this node reproduces that series bar-for-bar.
const RSI14: Node = node('rsi', [CLOSE], { period: 14 });

/** Detectors that additionally read RSI(14) (the RSI-divergence patterns). */
const RSI_DIVERGENCE: ReadonlySet<string> = new Set(['bull_div', 'bear_div']);

/** The engine's fallback lookback when a pattern rule omits `n` (`+(rule.n) || 3`). */
const DEFAULT_N = 3;

/**
 * Lower a price-action pattern to a boolean `pattern` DAG node (ADR-005 /
 * SAD-002#8.5). `pat` is the pattern name (e.g. `'consec_down'`, `'new_high'`,
 * `'bull_div'`); `n` is its lookback — omit it to take the engine default (`3`),
 * matching `evalPatternAt`'s `+(rule.n) || 3`. Inputs are the raw OHLC sources
 * (`open`,`high`,`low`,`close`) in that fixed order, with `RSI(14)` appended for the
 * RSI-divergence detectors. The returned node is immutable/serialisable and carries
 * a derived level from its inputs (SAD-002#5.1, #2.6); evaluating it via the shared
 * kernel set yields the pattern's boolean flag series bar-for-bar equal to
 * `evalPatternAt` for `{ kind:'pattern', pat, n }`.
 */
export function patternNode(pat: string, n?: number): Node {
  const inputs = RSI_DIVERGENCE.has(pat)
    ? [OPEN, HIGH, LOW, CLOSE, RSI14]
    : [OPEN, HIGH, LOW, CLOSE];
  return node('pattern', inputs, { pat, n: n ?? DEFAULT_N });
}
