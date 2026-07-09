// dag/lower.ts — the shared indicator lowering layer (STORY-043, SAD-002#5.3).
//
// One lowering path from a persisted `IndicatorDef` onto DAG nodes, so indicator
// evaluation runs through the DAG bar-for-bar identical to the current engine and
// cannot diverge (SAD-002#5.3, #2.1). The persisted `IndicatorDef` JSON is unchanged
// — lowering happens at evaluation time with no saved-artifact migration
// (SAD-002#6.4). Lowering is pure and isomorphic (SAD-002#2.2): a def in, a frozen
// node graph out, no I/O, no global state.
//
// Scope note: this lowers `IndicatorDef` types only (ema/sma/rsi/macd/stochrsi/price).
// Rule-operand / preset / PCF lowering needs the offset/affine/const primitive that
// does not exist yet (STORY-057) and is out of scope here (STORY-058).
//
// Reuse over re-derivation (SAD-002#5.3):
//   - `def.source` maps to the existing raw-source node kinds (close/open/high/low/
//     hl2/hlc3/volume) — hl2/hlc3 are already kerneled raw sources, never re-derived.
//   - `ema`/`sma`/`rsi` lower to the existing aggregation node kinds, reading the
//     same `{ period }` param the engine's aggregation kernels read.
//   - `macd` lowers to a GRAPH of existing kinds (ema + algebraic `sub`), so no
//     arithmetic is re-implemented (ADR-004): the engine's `macdFull` computes the
//     signal as an EMA of the MACD line using the same `ema`, so the graph is
//     bar-for-bar.
//   - `stochrsi`'s rolling min/max of RSI is not graph-expressible, so it uses the
//     genuine composite `stochrsi` kernel for the normalisation; %K/%D smoothing are
//     plain `sma` graph nodes, matching the engine's `stochRsi`.
//
// Purity (SAD-002#5.1): this module imports only the node model — never `market.ts`
// (that would introduce a `dag/ → market.ts` cycle).
import { node, source, type Node, type RawSourceKind } from './node.ts';

/**
 * The structural shape of a persisted indicator definition this layer lowers. A
 * structural subset of the engine's `IndicatorDef` (so the engine's def satisfies it
 * without importing it here, keeping `dag/` free of a `market.ts` dependency). Only
 * the keys relevant to a def's `type` are read (mirroring `indSeries`).
 */
export interface IndicatorDef {
  type: string;
  source?: string;
  length?: number | string;
  fast?: number | string;
  slow?: number | string;
  signal?: number | string;
  output?: string;
  rsiLen?: number | string;
  stochLen?: number | string;
  kSmooth?: number | string;
  dSmooth?: number | string;
}

/** The raw-source kinds `def.source` can name; anything else falls back to `close`. */
const RAW_SOURCE_KINDS: readonly RawSourceKind[] = [
  'open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3',
];

/**
 * Map `def.source` to a raw-source node kind, reusing the existing kinds rather than
 * re-deriving hl2/hlc3 (SAD-002#5.3). Mirrors `srcArr`: a recognised source maps
 * straight through; anything absent/unknown defaults to `close`.
 */
function sourceKind(src: string | undefined): RawSourceKind {
  return src && (RAW_SOURCE_KINDS as readonly string[]).includes(src)
    ? (src as RawSourceKind)
    : 'close';
}

/** Coerce a def's numeric param exactly as `indSeries` does (`+value`). */
function num(v: number | string | undefined): number {
  return +(v as number);
}

/**
 * Lower one `IndicatorDef` onto a DAG node whose evaluation is bar-for-bar identical
 * to `indSeries(stock, def)` (SAD-002#5.3, #2.1). Pure and isomorphic (SAD-002#2.2).
 *
 * - `price` → the raw-source node for `def.source` (indSeries returns `src.slice()`).
 * - `ema`/`sma`/`rsi` → the aggregation node over that source, `{ period: length }`.
 * - `macd` → `line = sub(ema(src, fast), ema(src, slow))`, `signal = ema(line,
 *   signalLen)`, `hist = sub(line, signal)`; `output` selects line/signal/hist
 *   (default `line`, matching indSeries).
 * - `stochrsi` → `k = sma(stochrsi(rsi(src, rsiLen), stochLen), kSmooth)` and
 *   `d = sma(k, dSmooth)`; `output` selects k/d (default `k`). The composite
 *   `stochrsi` kernel performs the rolling min/max normalisation of the RSI series.
 */
export function lowerIndicator(def: IndicatorDef): Node {
  const src = source(sourceKind(def.source));
  switch (def.type) {
    case 'ema':
    case 'sma':
    case 'rsi':
      return node(def.type, [src], { period: num(def.length) });

    case 'macd': {
      const line = node('sub', [
        node('ema', [src], { period: num(def.fast) }),
        node('ema', [src], { period: num(def.slow) }),
      ]);
      const signal = node('ema', [line], { period: num(def.signal) });
      if (def.output === 'signal') return signal;
      if (def.output === 'hist') return node('sub', [line, signal]);
      return line;
    }

    case 'stochrsi': {
      const r = node('rsi', [src], { period: num(def.rsiLen) });
      const stoch = node('stochrsi', [r], { period: num(def.stochLen) });
      const k = node('sma', [stoch], { period: num(def.kSmooth) });
      if (def.output === 'd') return node('sma', [k], { period: num(def.dSmooth) });
      return k;
    }

    case 'price':
    default:
      return src;
  }
}
