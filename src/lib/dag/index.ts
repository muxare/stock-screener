// dag/index.ts — the computation-DAG engine core (SAD-002#5.1/#5.2).
//
// The node model (STORY-039) and the topological memoising evaluator (STORY-040)
// together form the engine's explicit dependency model. Both are pure,
// dependency-free, and isomorphic (SAD-002#2.2); the engine re-exports this
// barrel as `dag`.
export * from './node.ts';
export * from './eval.ts';
