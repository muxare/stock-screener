// dag/eval.ts — the topological, memoising node evaluator (STORY-040, CAP-dag-eval).
//
// Given an instrument's bars and a target node, compute the node and its
// transitive inputs *once each*, bottom-up in topological order (SAD-002#5.2).
// Results are memoised per node identity (`nodeKey`, SAD-002#6.1/#6.3): a node
// shared by multiple targets is computed once (dedup, SAD-002#2.4), a
// catalogued-but-unreferenced node is never computed (pruning, SAD-002#2.4), and
// a changed node has a new identity, hence a new cache key (correct invalidation,
// SAD-002#2.7). This replaces the flat `indSeries`/`defSig` cache mechanism
// (SAD-001#6.2) while preserving its outputs.
//
// This module is the evaluation *machinery* only: the per-kind compute kernels
// (the actual EMA/SMA/RSI math) are supplied by the caller as a `Kernels` table,
// so the engine can wire them over its existing math without this module
// depending on it. The taxonomy kinds without a registered kernel — algebraic
// (STORY-041), relational (STORY-042), and lowered real indicators (STORY-043) —
// are reserved: evaluating one throws rather than guessing.
//
// Purity is non-negotiable (SAD-002#2.2): bars in, values out. No I/O, no global
// state, no notion of "today". The cache is a plain `Map` the caller owns and
// attaches to the instrument like today's `_indCache` (SAD-002#6.3) — derived and
// ephemeral, never a source of truth.

import { nodeKey, type Node, type NodeKind, type NodeParams } from './node';

/** A computed series, one value per bar. `null` marks an undefined/warm-up bar. */
export type Series = readonly (number | null)[];

/**
 * The raw OHLCV a raw-source kernel reads. A structural subset of the engine's
 * `OHLC` so this module stays dependency-free — the engine's `full` satisfies it.
 */
export interface Bars {
  readonly o: readonly number[];
  readonly h: readonly number[];
  readonly l: readonly number[];
  readonly c: readonly number[];
  readonly v: readonly number[];
}

/**
 * A per-kind compute kernel: given the already-computed series of a node's inputs
 * (in declaration order), its params, and the instrument's bars, return the node's
 * series. Raw-source kernels read `bars` and ignore `inputs`; every other kernel
 * derives its output from `inputs`. Kernels must be pure.
 */
export type Kernel = (inputs: readonly Series[], params: NodeParams, bars: Bars) => Series;

/** The kernel table: a partial map from node kind to kernel. Missing kind ⇒ reserved. */
export type Kernels = Readonly<Partial<Record<NodeKind, Kernel>>>;

/** The per-(instrument) memo cache: node identity → series. Owned by the caller. */
export type EvalCache = Map<string, Series>;

/**
 * The node-evaluation counter (SAD-002#2.4) — a test/instrumentation affordance,
 * NOT a production dependency (SAD-002#7). `evaluations` counts kernel invocations
 * (cache misses); `computed` lists the node identities computed in bottom-up order
 * (each once); `counts` records per-identity invocations so a shared node reads 1
 * and a pruned node reads 0.
 */
export interface EvalStats {
  evaluations: number;
  readonly computed: string[];
  readonly counts: Map<string, number>;
}

/** A fresh, zeroed stats collector. */
export function newStats(): EvalStats {
  return { evaluations: 0, computed: [], counts: new Map() };
}

/** How many times the kernel for `key` ran under `stats` (0 = never / pruned). */
export function countFor(stats: EvalStats, key: string): number {
  return stats.counts.get(key) ?? 0;
}

/**
 * Evaluate `target` over `bars`, memoising into `cache`. Inputs are evaluated
 * before the node (post-order DFS = bottom-up topological order, SAD-002#5.2); a
 * node already in `cache` is returned without recomputation (dedup, SAD-002#2.4);
 * only nodes reachable from `target` are ever visited (pruning, SAD-002#2.4).
 *
 * `cache` defaults to a fresh map; pass a shared, instrument-scoped map to memoise
 * across calls. Pass `stats` to record the node-evaluation counter.
 */
export function evaluate(
  target: Node,
  bars: Bars,
  kernels: Kernels,
  cache: EvalCache = new Map(),
  stats?: EvalStats,
): Series {
  const key = nodeKey(target);
  const cached = cache.get(key);
  if (cached !== undefined) return cached; // memo hit — no recompute, no counter bump

  // Bottom-up: every input is computed (and cached) before this node, so a shared
  // sub-expression referenced again anywhere hits the cache above.
  const inputs = target.inputs.map((input) => evaluate(input, bars, kernels, cache, stats));

  const kernel = kernels[target.kind];
  if (!kernel) {
    throw new Error(
      `no evaluator kernel registered for node kind '${target.kind}' ` +
        `(reserved: algebraic→STORY-041, relational→STORY-042, lowered defs→STORY-043)`,
    );
  }
  const series = kernel(inputs, target.params, bars);

  cache.set(key, series);
  if (stats) {
    stats.evaluations += 1;
    stats.computed.push(key);
    stats.counts.set(key, (stats.counts.get(key) ?? 0) + 1);
  }
  return series;
}

/**
 * Evaluate several targets sharing one `cache`, so sub-expressions common to more
 * than one target are computed once across the whole set (SAD-002#2.4). Returns a
 * series per target, in order.
 */
export function evaluateAll(
  targets: readonly Node[],
  bars: Bars,
  kernels: Kernels,
  cache: EvalCache = new Map(),
  stats?: EvalStats,
): Series[] {
  return targets.map((t) => evaluate(t, bars, kernels, cache, stats));
}
