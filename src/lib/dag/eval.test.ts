// dag/eval.test.ts — the topological memoising evaluator contract (STORY-040,
// CAP-dag-eval). Each `describe` maps to an acceptance criterion: topological
// order, memoise-once + shared-dedup, pruning, node-identity cache keys +
// non-stale invalidation, boundedness over a large universe, ephemeral/rebuildable
// cache, no latency regression (+ output parity with the old path), and purity.

import { describe, it, expect } from 'vitest';
import evalSource from './eval.ts?raw'; // Vite `?raw`: the evaluator's own source, for the purity guard.
import { node, source, nodeKey } from './node';
import { evaluate, evaluateAll, newStats, countFor, type Bars } from './eval';
import {
  buildUniverse, indSeries, evalDagNode, DAG_KERNELS, ema,
  type Stock, type IndicatorDef,
} from '../market';
import { syntheticProvider } from '../data/synthetic';

// ---------- fixtures ----------
const CLOSE = source('close');
const EMA20 = node('ema', [CLOSE], { period: 20 });
const EMA50 = node('ema', [CLOSE], { period: 50 });
const SMA50 = node('sma', [CLOSE], { period: 50 });
const RSI14 = node('rsi', [CLOSE], { period: 14 });

// A multi-hundred-instrument universe from the synthetic adapter (SAD-002#8.2 /
// ADR-007): 44 tickers × 7 seeds = 308 instruments. Built once, reused read-only.
function bigUniverse(seeds = 7): Stock[] {
  const out: Stock[] = [];
  for (let s = 0; s < seeds; s++) out.push(...buildUniverse(syntheticProvider(7 + s).getUniverse()));
  return out;
}
const UNIVERSE = bigUniverse();
const CLOSE_OF = (stock: Stock): number[] => stock.full.c;
// The engine's `full` (OHLC, with `v` optional) satisfies the evaluator's `Bars`
// contract — buildStock always populates volume. Bridge the type at the boundary.
const barsOf = (stock: Stock): Bars => stock.full as Bars;

describe('topological, bottom-up evaluation (SAD-002#5.2, AC#1)', () => {
  it('computes every input before the node that consumes it', () => {
    // sma5( ema20( close ) ) — a 2-level chain; evaluation order must be
    // close → ema20 → sma5 (each input strictly before its consumer).
    const sma5OfEma = node('sma', [EMA20], { period: 5 });
    const stats = newStats();
    evaluate(sma5OfEma, barsOf(UNIVERSE[0]), DAG_KERNELS, new Map(), stats);
    expect(stats.computed).toEqual([nodeKey(CLOSE), nodeKey(EMA20), nodeKey(sma5OfEma)]);
  });
});

describe('memoise once + shared-subexpression dedup (SAD-002#2.4, AC#2)', () => {
  it('computes each node once and does not recompute a shared sub-expression', () => {
    // Two targets both reach EMA20 (directly, and as sma5's input). A shared cache
    // must compute close/ema20 exactly once across both targets.
    const sma5OfEma = node('sma', [EMA20], { period: 5 });
    const cache = new Map();
    const stats = newStats();
    evaluateAll([EMA20, sma5OfEma], barsOf(UNIVERSE[0]), DAG_KERNELS, cache, stats);

    // distinct reachable nodes = { close, ema20, sma5(ema20) } = 3.
    expect(stats.evaluations).toBe(3);
    expect(countFor(stats, nodeKey(CLOSE))).toBe(1);
    expect(countFor(stats, nodeKey(EMA20))).toBe(1); // shared, computed once
    expect(cache.size).toBe(3);
  });
});

describe('pruning to reachable nodes (SAD-002#2.4, AC#3)', () => {
  it('records zero evaluations for a catalogued-but-unreferenced node', () => {
    // The catalogue holds EMA20/SMA50/RSI14, but only EMA20 is a target.
    const stats = newStats();
    evaluate(EMA20, barsOf(UNIVERSE[0]), DAG_KERNELS, new Map(), stats);
    expect(countFor(stats, nodeKey(EMA20))).toBe(1);
    expect(countFor(stats, nodeKey(SMA50))).toBe(0); // never computed
    expect(countFor(stats, nodeKey(RSI14))).toBe(0); // never computed
    expect(stats.computed).not.toContain(nodeKey(SMA50));
  });
});

describe('node-identity cache keys + non-stale invalidation (SAD-002#2.7, AC#4)', () => {
  it('adds a new node after first evaluation and returns a correct, non-stale series', () => {
    const bars = barsOf(UNIVERSE[0]);
    const cache = new Map();
    const first = evaluate(EMA20, bars, DAG_KERNELS, cache); // seeds close + ema20

    // Add a genuinely new node (different params ⇒ different identity) against the
    // warm cache: it must compute fresh and correct, not reuse the ema20 entry.
    const added = evaluate(EMA50, bars, DAG_KERNELS, cache);
    expect(added).toEqual(ema(CLOSE_OF(UNIVERSE[0]), 50));
    // The original entry is untouched and still correct (non-stale).
    expect(first).toEqual(ema(CLOSE_OF(UNIVERSE[0]), 20));
    expect(cache.get(nodeKey(EMA20))).toBe(first);
  });

  it('gives a changed node a new key (implicit invalidation)', () => {
    expect(nodeKey(EMA20)).not.toBe(nodeKey(EMA50));                                   // param change
    expect(nodeKey(EMA20)).not.toBe(nodeKey(node('ema', [source('open')], { period: 20 }))); // input change
    expect(nodeKey(EMA20)).not.toBe(nodeKey(node('sma', [CLOSE], { period: 20 })));    // kind change
  });
});

describe('bounded cache over a large universe (SAD-002#2.7, AC#5)', () => {
  it('holds one entry per distinct node — bounded by DAG size, not bars or universe size', () => {
    expect(UNIVERSE.length).toBeGreaterThanOrEqual(300); // multi-hundred instruments
    const catalogue = [EMA20, SMA50, RSI14];
    const distinct = 4; // { close, ema20, sma50, rsi14 }
    for (const stock of UNIVERSE) {
      const cache = new Map();
      evaluateAll(catalogue, barsOf(stock), DAG_KERNELS, cache);
      expect(cache.size).toBe(distinct);           // constant across all 308 instruments
      expect(cache.size).toBeLessThan(stock.full.c.length); // << bar count (260) — not per-bar
    }
  });
});

describe('ephemeral, rebuildable cache (SAD-002#6.3, AC#6)', () => {
  it('is derived — clearing it and re-evaluating rebuilds the identical series from bars + nodes', () => {
    const stock = UNIVERSE[0];
    delete stock._dagCache;
    const before = evalDagNode(stock, EMA20);
    expect(stock._dagCache).toBeInstanceOf(Map); // cache is attached to the instrument
    delete stock._dagCache;                       // cache is not a source of truth
    const rebuilt = evalDagNode(stock, EMA20);
    expect(rebuilt).toEqual(before);              // rebuilt purely from bars + nodes
  });
});

describe('output parity + no latency regression (SAD-002#2.5/#5.2, AC#7)', () => {
  it('is bar-for-bar identical to the old indSeries path across the universe', () => {
    const emaDef: IndicatorDef = { type: 'ema', source: 'close', length: 20 };
    const smaDef: IndicatorDef = { type: 'sma', source: 'close', length: 50 };
    const rsiDef: IndicatorDef = { type: 'rsi', source: 'close', length: 14 };
    for (const stock of UNIVERSE) {
      delete stock._dagCache; delete stock._indCache;
      expect(evalDagNode(stock, EMA20)).toEqual(indSeries(stock, emaDef));
      expect(evalDagNode(stock, SMA50)).toEqual(indSeries(stock, smaDef));
      expect(evalDagNode(stock, RSI14)).toEqual(indSeries(stock, rsiDef));
    }
  });

  it('evaluates the fixture universe within budget and within tolerance of the old path', () => {
    const emaDef: IndicatorDef = { type: 'ema', source: 'close', length: 20 };
    const smaDef: IndicatorDef = { type: 'sma', source: 'close', length: 50 };
    const rsiDef: IndicatorDef = { type: 'rsi', source: 'close', length: 14 };
    const catalogue = [EMA20, SMA50, RSI14];

    const timeNew = (): number => {
      const t0 = performance.now();
      for (const stock of UNIVERSE) {
        delete stock._dagCache;
        evaluateAll(catalogue, barsOf(stock), DAG_KERNELS, (stock._dagCache = new Map()));
      }
      return performance.now() - t0;
    };
    const timeOld = (): number => {
      const t0 = performance.now();
      for (const stock of UNIVERSE) {
        delete stock._indCache;
        indSeries(stock, emaDef); indSeries(stock, smaDef); indSeries(stock, rsiDef);
      }
      return performance.now() - t0;
    };

    timeNew(); timeOld();                    // warm up JIT, then measure cold caches
    const newMs = timeNew();
    const oldMs = timeOld();

    // Budget: full-universe evaluation well under the SAD-001#2.3 warm p95 (3 s).
    expect(newMs).toBeLessThan(3000);
    // No regression: reusing the same math + memoising should keep new ≤ old; a
    // generous tolerance guards against CI timing noise while still catching a
    // real blow-up (e.g. recomputing shared sub-expressions).
    expect(newMs).toBeLessThan(oldMs * 4 + 5);
  });
});

describe('engine purity (SAD-002#2.2, AC#8)', () => {
  it('imports nothing from React/DOM/Node and uses no fetch/global/"today"', () => {
    const code = evalSource.replace(/\/\/.*$/gm, ''); // strip line comments so prose can't trip the guards
    expect(code).not.toMatch(/from\s+['"](react|react-dom|react\/|node:|fs|path)/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bnew\s+Date\b|\bDate\s*\.\s*now\b|\bperformance\s*\.\s*now\b/);
    expect(code).not.toMatch(/\bMath\s*\.\s*random\b/);
    expect(code).not.toMatch(/\b(window|document|globalThis|process)\b/);
  });

  it('is a pure function of (node, bars): no bar mutation, deterministic output', () => {
    const bars = barsOf(UNIVERSE[0]);
    const snapshot = bars.c.slice();
    const a = evaluate(EMA20, bars, DAG_KERNELS);
    const b = evaluate(EMA20, bars, DAG_KERNELS); // fresh cache each call
    expect(a).toEqual(b);            // same inputs ⇒ same output
    expect(bars.c).toEqual(snapshot); // inputs are not mutated
  });
});

describe('reserved kinds are firewalled (STORY-041/042/043)', () => {
  it('throws rather than guessing when a kind has no registered kernel', () => {
    const add = node('add', [EMA20, SMA50], {});    // algebraic — STORY-041
    const gt = node('gt', [EMA20, SMA50], {});       // relational — STORY-042
    const macd = node('macd', [EMA20, EMA50], { signal: 9 }); // composite — lowering STORY-043
    for (const n of [add, gt, macd]) {
      expect(() => evaluate(n, barsOf(UNIVERSE[0]), DAG_KERNELS)).toThrow(/no evaluator kernel|reserved/i);
    }
  });
});
