// dag/kernels/algebraic.test.ts — the algebraic node-family contract (STORY-041,
// CAP-algebra). Each `describe` maps to an acceptance criterion: the `+ − × ÷`
// kinds exist and produce scalar series, level is carried by inputs, a composed
// expression evaluates correctly, div-by-zero / null follow the engine's
// null-handling (no new NaN/Infinity), hl2/hlc3 stay bit-identical with no second
// arithmetic path, and nodes stay plain/immutable/pure.

import { describe, it, expect } from 'vitest';
import { node, source, level, type Node } from '../node.ts';
import { evaluate, type Bars, type Series } from '../eval.ts';
import { algebraicKernels } from './algebraic.ts';
import { DAG_KERNELS, buildUniverse, type Stock } from '../../market';
import { syntheticProvider } from '../../data/synthetic';

// A dummy Bars — the algebraic kernels never read `bars` (they combine `inputs` only).
const NO_BARS: Bars = { o: [], h: [], l: [], c: [] };
// Direct-kernel helper: invoke a registered algebraic kernel over crafted series.
const run = (kind: 'add' | 'sub' | 'mul' | 'div', inputs: Series[]): Series =>
  algebraicKernels[kind]!(inputs, {}, NO_BARS);

// A real instrument, so the composed-expression AC runs against genuine EMA series.
const UNIVERSE: Stock[] = buildUniverse(syntheticProvider(7).getUniverse());
const STOCK = UNIVERSE[0];
const barsOf = (s: Stock): Bars => s.full;
const CLOSE = source('close');
const EMA18 = node('ema', [CLOSE], { period: 18 });
const EMA50 = node('ema', [CLOSE], { period: 50 });

describe('the four algebraic kinds exist and produce scalar series (AC#1)', () => {
  it('registers add/sub/mul/div and combines inputs element-wise', () => {
    for (const k of ['add', 'sub', 'mul', 'div'] as const) {
      expect(typeof algebraicKernels[k]).toBe('function');
    }
    const a = [1, 2, 3];
    const b = [10, 20, 40];
    expect(run('add', [a, b])).toEqual([11, 22, 43]);
    expect(run('sub', [a, b])).toEqual([-9, -18, -37]);
    expect(run('mul', [a, b])).toEqual([10, 40, 120]);
    expect(run('div', [b, a])).toEqual([10, 10, 40 / 3]);
  });

  it('folds n-ary inputs left-to-right (add/mul associative, sub/div left-fold)', () => {
    expect(run('add', [[1], [2], [3]])).toEqual([6]);
    expect(run('mul', [[2], [3], [4]])).toEqual([24]);
    expect(run('sub', [[10], [3], [2]])).toEqual([5]); // (10-3)-2
    expect(run('div', [[24], [2], [3]])).toEqual([4]); // (24/2)/3
  });
});

describe('level is carried by the inputs (AC#2)', () => {
  it('an algebraic node over L1 inputs is L2, and composes upward', () => {
    expect(level(EMA18)).toBe(1); // aggregation over a raw source
    const diff = node('sub', [EMA18, EMA50]); // over two L1 → L2
    expect(level(diff)).toBe(2);
    const scaled = node('div', [diff, CLOSE]); // over an L2 and an L0 → 1 + max(2,0)
    expect(level(scaled)).toBe(3);
  });
});

describe('a composed expression evaluates correctly (AC#3)', () => {
  it('(EMA18 − EMA50) / close is bar-for-bar the manual computation', () => {
    const bars = barsOf(STOCK);
    const ema18 = evaluate(EMA18, bars, DAG_KERNELS);
    const ema50 = evaluate(EMA50, bars, DAG_KERNELS);
    const expr = node('div', [node('sub', [EMA18, EMA50]), CLOSE]);
    const got = evaluate(expr, bars, DAG_KERNELS);

    const want = bars.c.map((c, i) => {
      const l = ema18[i];
      const r = ema50[i];
      if (l == null || r == null) return null;
      return c === 0 ? null : (l - r) / c;
    });
    expect(got).toEqual(want);
  });
});

describe('div-by-zero / null follow the engine null-handling — no new NaN/Infinity (AC#4)', () => {
  it('a null or NaN operand propagates to a null result', () => {
    expect(run('add', [[1, null, 3], [1, 2, 3]])).toEqual([2, null, 6]);
    expect(run('mul', [[1, NaN, 3], [5, 5, 5]])).toEqual([5, null, 15]);
    expect(run('sub', [[1, 2, null], [1, 2, 3]])).toEqual([0, 0, null]);
  });

  it('division by zero yields null, never Infinity or NaN', () => {
    expect(run('div', [[1, 0, 4], [0, 0, 2]])).toEqual([null, null, 2]);
  });

  it('never emits Infinity or NaN anywhere in the output series', () => {
    const nums = [1, 0, -5, 1e6, null, NaN];
    const divisor = [0, 0, 2, 0, 5, 5];
    for (const k of ['add', 'sub', 'mul', 'div'] as const) {
      for (const v of run(k, [nums, divisor])) {
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('hl2/hlc3 stay bit-identical with no second arithmetic path (AC#5)', () => {
  it('the hl2/hlc3 raw-source kernels remain the exact (H+L)/2 and (H+L+C)/3', () => {
    const bars = barsOf(STOCK);
    const hl2 = evaluate(source('hl2'), bars, DAG_KERNELS);
    const hlc3 = evaluate(source('hlc3'), bars, DAG_KERNELS);
    expect(hl2).toEqual(bars.c.map((_, i) => (bars.h[i] + bars.l[i]) / 2));
    expect(hlc3).toEqual(bars.c.map((_, i) => (bars.h[i] + bars.l[i] + bars.c[i]) / 3));
  });

  it('the numerator (H+L) is expressible via the algebraic add with no divergence', () => {
    const bars = barsOf(STOCK);
    const high = evaluate(source('high'), bars, DAG_KERNELS);
    const low = evaluate(source('low'), bars, DAG_KERNELS);
    const hl2 = evaluate(source('hl2'), bars, DAG_KERNELS);
    // add(high, low) reproduces the H+L arithmetic hl2 is built from, bar-for-bar —
    // one arithmetic implementation (the scalar `/2` constant lowers in STORY-043).
    const sum = run('add', [high, low]);
    expect(sum).toEqual(bars.h.map((h, i) => h + bars.l[i]));
    expect(sum).toEqual(hl2.map((v) => (v as number) * 2));
  });
});

describe('nodes stay plain, serialisable, immutable, pure (AC#6)', () => {
  const n: Node = node('add', [EMA18, EMA50]);

  it('is frozen plain data and round-trips through JSON', () => {
    expect(Object.isFrozen(n)).toBe(true);
    expect(Object.isFrozen(n.inputs)).toBe(true);
    const clone = JSON.parse(JSON.stringify(n));
    expect(clone.kind).toBe('add');
    expect(clone.inputs).toHaveLength(2);
  });

  it('the kernel does not mutate its input series', () => {
    const a = Object.freeze([1, 2, 3]) as Series;
    const b = Object.freeze([4, 5, 6]) as Series;
    const snapA = [...a];
    const snapB = [...b];
    run('add', [a, b]);
    run('div', [a, b]);
    expect([...a]).toEqual(snapA);
    expect([...b]).toEqual(snapB);
  });
});
