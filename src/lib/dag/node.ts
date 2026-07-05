// dag/node.ts — the computation-DAG node model (STORY-039, CAP-dag-model).
//
// The engine's explicit dependency model: indicators are immutable nodes in an
// acyclic graph. A node is plain, serialisable data — `{ kind, inputs, params }`
// (SAD-002#6.1) — carrying no closures/functions. `level` is *derived* by walking
// inputs (SAD-002#2.6), never stored or hand-assigned. Node identity is a pure
// structural signature generalising today's `defSig` (SAD-002#6.1): equal
// structure ⇒ equal key (dedup), any change ⇒ new key (invalidation).
//
// This is the data model ONLY: no evaluator/cache (STORY-040), no lowering of real
// IndicatorDefs (STORY-043), no algebraic/relational *behaviour* (STORY-041/042) —
// those kinds are merely reserved in the taxonomy here.
//
// Purity is non-negotiable (SAD-002#2.2): this module imports nothing from
// React/DOM/Node, performs no fetch, holds no global state, and has no notion of
// "today". It is a dependency-free, isomorphic ES module.

// ---------- node-kind taxonomy (SAD-002#6.2) ----------

/** L0 raw sources: OHLCV plus derived price sources. Inputs: none. */
export type RawSourceKind =
  | 'open' | 'high' | 'low' | 'close' | 'volume' | 'hl2' | 'hlc3';

/** L1 aggregations over raw sources only: `ema`/`sma`/`rsi`, rolling/vol averages. */
export type AggregationKind = 'ema' | 'sma' | 'rsi' | 'rollingMean' | 'rollingSum';

/** L2+ composites whose inputs include aggregations: `macd`/`stochrsi`/`relVol`/price-vs-EMA. */
export type CompositeKind = 'macd' | 'stochrsi' | 'relVol' | 'priceVsEma';

/** Algebraic combinators over scalar inputs (SAD-002#8.4) — behaviour reserved for STORY-041. */
export type AlgebraicKind = 'add' | 'sub' | 'mul' | 'div';

/** Relational/boolean nodes with boolean output — behaviour reserved for STORY-042. */
export type RelationalKind =
  | 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'cross_up' | 'cross_down';

/** Boolean multi-bar structure detectors (SAD-002#8.5) — behaviour reserved. */
export type PatternKind = 'pattern';

export type NodeKind =
  | RawSourceKind | AggregationKind | CompositeKind
  | AlgebraicKind | RelationalKind | PatternKind;

/** The families of the taxonomy, in level-order for raw/aggregation/composite. */
export type NodeFamily =
  | 'raw-source' | 'aggregation' | 'composite'
  | 'algebraic' | 'relational' | 'pattern';

const KIND_FAMILY: Readonly<Record<NodeKind, NodeFamily>> = {
  open: 'raw-source', high: 'raw-source', low: 'raw-source', close: 'raw-source',
  volume: 'raw-source', hl2: 'raw-source', hlc3: 'raw-source',
  ema: 'aggregation', sma: 'aggregation', rsi: 'aggregation',
  rollingMean: 'aggregation', rollingSum: 'aggregation',
  macd: 'composite', stochrsi: 'composite', relVol: 'composite', priceVsEma: 'composite',
  add: 'algebraic', sub: 'algebraic', mul: 'algebraic', div: 'algebraic',
  gt: 'relational', lt: 'relational', gte: 'relational', lte: 'relational',
  eq: 'relational', neq: 'relational', cross_up: 'relational', cross_down: 'relational',
  pattern: 'pattern',
};

/** The family a node's kind belongs to (SAD-002#6.2). */
export function family(kind: NodeKind): NodeFamily {
  return KIND_FAMILY[kind];
}

function isRawSourceKind(kind: NodeKind): boolean {
  return KIND_FAMILY[kind] === 'raw-source';
}

// ---------- the node ----------

/** A parameter bag on a node: op/period/offset/mult/add etc. Serialisable scalars only. */
export type NodeParams = Readonly<Record<string, string | number | boolean>>;

/** An input reference is simply another node — the graph is by structural reference. */
export type NodeRef = Node;

/**
 * A DAG node: plain, serialisable data (SAD-002#6.1). `kind` names a taxonomy
 * entry, `inputs` reference other nodes (raw sources have none), `params` carries
 * scalar op/parameters. No closures are ever stored. Frozen after construction.
 */
export interface Node {
  readonly kind: NodeKind;
  readonly inputs: readonly NodeRef[];
  readonly params: NodeParams;
}

// ---------- construction (immutable, validated, acyclic) ----------

function freezeParams(params: NodeParams): NodeParams {
  // Params are flat scalar bags; a shallow freeze fully seals them.
  return Object.freeze({ ...params });
}

/**
 * Construct an immutable node. Validates the kind/inputs contract of the taxonomy
 * (raw sources take no inputs; every other kind takes ≥1) and that the resulting
 * graph is acyclic (SAD-002#6.1), then deep-freezes so nodes cannot be mutated
 * after construction (SAD-002#5.1).
 */
export function node(kind: NodeKind, inputs: readonly NodeRef[] = [], params: NodeParams = {}): Node {
  if (isRawSourceKind(kind)) {
    if (inputs.length > 0) {
      throw new Error(`raw-source node '${kind}' must have no inputs (SAD-002#6.2)`);
    }
  } else if (inputs.length === 0) {
    throw new Error(`non-raw node '${kind}' requires at least one input (SAD-002#6.2)`);
  }
  const n: Node = Object.freeze({
    kind,
    inputs: Object.freeze(inputs.slice()),
    params: freezeParams(params),
  });
  // Inputs are already-constructed frozen nodes, so a bottom-up build is acyclic by
  // design; assertAcyclic enforces the invariant defensively and rejects any cycle.
  assertAcyclic(n);
  return n;
}

/** Construct a raw-source (L0) node. */
export function source(kind: RawSourceKind): Node {
  return node(kind, [], {});
}

// ---------- derived level (SAD-002#2.6) ----------

/**
 * A node's level, computed by walking inputs — never stored or hand-assigned
 * (SAD-002#2.6). Raw sources (no inputs) are level 0; every other node is
 * `1 + max(level of its inputs)`.
 */
export function level(n: Node): number {
  if (n.inputs.length === 0) return 0;
  let max = 0;
  for (const input of n.inputs) {
    const l = level(input);
    if (l > max) max = l;
  }
  return 1 + max;
}

// ---------- structural identity (SAD-002#6.1, generalises defSig) ----------

/**
 * A node's structural identity: a pure signature over `(kind, params, input
 * identities)` (SAD-002#6.1). Equal structure yields an equal key (enabling dedup,
 * SAD-002#2.4); any change to kind/params/inputs yields a different key (enabling
 * correct invalidation, SAD-002#2.7). Instrument-independent — the generalisation
 * of today's `defSig`.
 *
 * Encoded as a canonical JSON tuple `[kind, sortedParamEntries, inputKeys]` rather
 * than a hand-delimited string: JSON.stringify escapes any delimiter a param value
 * might contain and preserves scalar *type* (so `{period: 20}` and `{period: '20'}`
 * are distinct), closing the collision class that a raw `k=v` join would open.
 * Keys are sorted so equal params yield an identical encoding regardless of order.
 */
export function nodeKey(n: Node): string {
  const params = Object.keys(n.params)
    .sort()
    .map((k) => [k, n.params[k]] as const);
  const inputs = n.inputs.map(nodeKey);
  return JSON.stringify([n.kind, params, inputs]);
}

// ---------- acyclicity (SAD-002#6.1) ----------

/**
 * Assert the graph reachable from `n` is acyclic, throwing on a back edge. Bottom-up
 * construction cannot form a cycle, so this is a defensive guard that also makes
 * "attempting to build a cycle is rejected" (SAD-002#6.1) an enforced invariant.
 */
export function assertAcyclic(n: Node): void {
  const onPath = new Set<Node>();
  const cleared = new Set<Node>();
  const walk = (m: Node): void => {
    if (cleared.has(m)) return;
    if (onPath.has(m)) {
      throw new Error(`cycle detected in DAG at node '${m.kind}' (SAD-002#6.1)`);
    }
    onPath.add(m);
    for (const input of m.inputs) walk(input);
    onPath.delete(m);
    cleared.add(m);
  };
  walk(n);
}
