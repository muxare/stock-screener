// dag/pattern.test.ts — the pattern node-family parity contract (STORY-044,
// CAP-pattern-nodes). Each `describe` maps to an acceptance criterion: every entry
// in `PATTERNS` lowers to a boolean `pattern` DAG node over raw + indicator-level
// inputs; each node's flag matches `evalPatternAt` BAR-FOR-BAR over the fixture
// universe (including the multi-bar and `n`-parameterised detectors); pattern nodes
// carry a derived level and stay immutable/serialisable/pure; and the flag is
// computed through the ordinary evaluator (memoised/prunable), not a side cache.
//
// market.ts is used ONLY as the parity ORACLE here (PATTERNS/evalPatternAt), never as
// an implementation dependency of the lowering (dag/pattern.ts) or kernel
// (dag/kernels/pattern.ts).

import { describe, it, expect } from 'vitest';
import { level, nodeKey } from './node.ts';
import { evaluate, newStats, countFor, type Series } from './eval.ts';
import { patternNode } from './pattern.ts';
import { patternKernels } from './kernels/pattern.ts';
import {
  PATTERNS, evalPatternAt, DAG_KERNELS, buildUniverse,
  type Stock, type PatternRule,
} from '../market';
import { syntheticProvider } from '../data/synthetic';

// THE canonical synthetic golden-master universe (seed 7), built exactly as
// fidelity.test.ts does — read-only across every check.
const UNIVERSE: Stock[] = buildUniverse(syntheticProvider().getUniverse());
const bars = (s: Stock) => s.full;

/** The DAG boolean flag series for a lowered pattern node over a stock's bars. */
function dagFlags(stock: Stock, pat: string, n?: number): Series {
  return evaluate(patternNode(pat, n), bars(stock), DAG_KERNELS);
}

/** The oracle: evalPatternAt as a full boolean series over a stock's bars. */
function oracleFlags(stock: Stock, pat: string, n?: number): boolean[] {
  const rule: PatternRule = { kind: 'pattern', pat, ...(n === undefined ? {} : { n }) };
  const len = stock.full.c.length;
  const out = new Array<boolean>(len);
  for (let i = 0; i < len; i++) out[i] = evalPatternAt(stock, rule, i);
  return out;
}

/** Assert `dagFlags === oracleFlags` at every bar of every instrument (bar-for-bar). */
function assertParity(pat: string, n?: number): void {
  for (const stock of UNIVERSE) {
    const series = dagFlags(stock, pat, n);
    const oracle = oracleFlags(stock, pat, n);
    expect(series.length).toBe(oracle.length);
    for (let i = 0; i < oracle.length; i++) {
      // A pattern series is boolean (1/0, never null); 1 ⇔ evalPatternAt true.
      expect(series[i] === 1).toBe(oracle[i]);
    }
  }
}

const PATTERN_NAMES = Object.keys(PATTERNS);
// The multi-bar / n-parameterised detectors (PATTERNS[*].count === true).
const COUNT_PATTERNS = PATTERN_NAMES.filter((p) => PATTERNS[p].count);
// The single-bar detectors (no lookback).
const SINGLE_PATTERNS = PATTERN_NAMES.filter((p) => !PATTERNS[p].count);

describe('every PATTERNS entry lowers to a boolean pattern node over raw+indicator inputs (AC#1)', () => {
  it('covers the whole PATTERNS set (nothing silently skipped)', () => {
    expect(PATTERN_NAMES.length).toBeGreaterThanOrEqual(17);
  });

  it('each lowered node is kind "pattern", carries { pat, n }, and reads raw OHLC inputs', () => {
    for (const pat of PATTERN_NAMES) {
      const nd = patternNode(pat, PATTERNS[pat].n);
      expect(nd.kind).toBe('pattern');
      expect(nd.params.pat).toBe(pat);
      expect(typeof nd.params.n).toBe('number');
      // open/high/low/close are the first four inputs of every pattern node.
      expect(nd.inputs.slice(0, 4).map((i) => i.kind)).toEqual(['open', 'high', 'low', 'close']);
    }
  });

  it('the RSI-divergence detectors additionally consume an RSI(14) indicator input', () => {
    for (const pat of ['bull_div', 'bear_div']) {
      const nd = patternNode(pat, PATTERNS[pat].n);
      expect(nd.inputs).toHaveLength(5);
      const rsi = nd.inputs[4];
      expect(rsi.kind).toBe('rsi');
      expect(rsi.params.period).toBe(14);
      expect(rsi.inputs[0].kind).toBe('close');
    }
    // non-divergence detectors carry exactly the four raw sources
    expect(patternNode('inside_bar').inputs).toHaveLength(4);
    expect(patternNode('consec_down', 3).inputs).toHaveLength(4);
  });
});

describe("each pattern node's flag matches evalPatternAt bar-for-bar (AC#2)", () => {
  it('matches for every single-bar detector across the universe', () => {
    for (const pat of SINGLE_PATTERNS) assertParity(pat);
  });

  it('matches for every count/lookback detector at its default n across the universe', () => {
    for (const pat of COUNT_PATTERNS) assertParity(pat, PATTERNS[pat].n);
  });
});

describe('multi-bar and n-parameterised detectors match the engine identically (AC#3)', () => {
  it('consecutive/structure detectors match across a sweep of n', () => {
    for (const pat of ['consec_down', 'consec_up', 'lower_closes', 'higher_closes', 'higher_hl', 'lower_hl']) {
      for (const n of [2, 3, 5, 8]) assertParity(pat, n);
    }
  });

  it('the N-bar breakout/breakdown detectors match across a sweep of n', () => {
    for (const pat of ['new_high', 'new_low']) {
      for (const n of [3, 10, 20, 50]) assertParity(pat, n);
    }
  });

  it('the RSI-divergence detectors match across a sweep of n', () => {
    for (const pat of ['bull_div', 'bear_div']) {
      for (const n of [10, 24, 40, 60]) assertParity(pat, n);
    }
  });

  it('the default lookback (n omitted) equals the engine fallback of 3', () => {
    // patternNode() with no n must equal evalPatternAt with rule.n undefined (→ 3).
    for (const pat of ['consec_down', 'new_high', 'bull_div']) assertParity(pat);
    // and n=3 explicitly yields the identical node identity.
    expect(nodeKey(patternNode('consec_down'))).toBe(nodeKey(patternNode('consec_down', 3)));
  });
});

describe('pattern nodes carry derived level and stay immutable/serialisable/pure (AC#4)', () => {
  it('a raw-only pattern is L1; an RSI-divergence pattern is L2 (level derived from inputs)', () => {
    expect(level(patternNode('inside_bar'))).toBe(1);            // 1 + max(level of OHLC = 0)
    expect(level(patternNode('consec_down', 5))).toBe(1);
    expect(level(patternNode('bull_div', 24))).toBe(2);         // 1 + max(0, level of rsi = 1)
    expect(level(patternNode('bear_div', 24))).toBe(2);
  });

  it('is frozen plain data and round-trips through JSON', () => {
    const nd = patternNode('bull_div', 24);
    expect(Object.isFrozen(nd)).toBe(true);
    expect(Object.isFrozen(nd.inputs)).toBe(true);
    expect(Object.isFrozen(nd.params)).toBe(true);
    const clone = JSON.parse(JSON.stringify(nd));
    expect(clone.kind).toBe('pattern');
    expect(clone.params).toEqual({ pat: 'bull_div', n: 24 });
    expect(clone.inputs).toHaveLength(5);
  });

  it('the kernel does not mutate its input series', () => {
    const o = Object.freeze([1, 2, 3, 2]) as Series;
    const h = Object.freeze([2, 3, 4, 3]) as Series;
    const l = Object.freeze([0, 1, 2, 1]) as Series;
    const c = Object.freeze([1.5, 2.5, 3.5, 1.5]) as Series;
    const snap = [o, h, l, c].map((s) => [...s]);
    patternKernels.pattern!([o, h, l, c], { pat: 'consec_down', n: 2 }, { o: [], h: [], l: [], c: [] });
    [o, h, l, c].forEach((s, k) => expect([...s]).toEqual(snap[k]));
  });

  it('equal (pat, n) lowers to an equal node key; a changed n yields a new key (isomorphism)', () => {
    expect(nodeKey(patternNode('new_high', 20))).toBe(nodeKey(patternNode('new_high', 20)));
    expect(nodeKey(patternNode('new_high', 20))).not.toBe(nodeKey(patternNode('new_high', 10)));
    expect(nodeKey(patternNode('new_high', 20))).not.toBe(nodeKey(patternNode('new_low', 20)));
  });
});

describe('pattern flags flow through the ordinary evaluator — memoised & prunable (AC#5)', () => {
  it('a shared pattern node is computed once across targets (dedup, no side cache)', () => {
    const stock = UNIVERSE[0];
    const target = patternNode('consec_down', 3);
    const cache = new Map<string, Series>();
    const stats = newStats();
    // Two evaluations against the SAME cache: the second is a pure memo hit.
    evaluate(target, bars(stock), DAG_KERNELS, cache, stats);
    evaluate(target, bars(stock), DAG_KERNELS, cache, stats);
    expect(countFor(stats, nodeKey(target))).toBe(1);
  });

  it('an uninvolved pattern node is never computed (pruning)', () => {
    const stock = UNIVERSE[0];
    const evaluated = patternNode('new_high', 20);
    const pruned = patternNode('new_low', 20);
    const stats = newStats();
    evaluate(evaluated, bars(stock), DAG_KERNELS, new Map(), stats);
    expect(countFor(stats, nodeKey(evaluated))).toBe(1);
    expect(countFor(stats, nodeKey(pruned))).toBe(0);
  });

  it('registers exactly one kernel under the "pattern" kind (dispatched by params.pat)', () => {
    expect(typeof patternKernels.pattern).toBe('function');
    expect(Object.keys(patternKernels)).toEqual(['pattern']);
    // the composed engine kernel set resolves the pattern kind
    expect(typeof (DAG_KERNELS as Record<string, unknown>).pattern).toBe('function');
  });
});
