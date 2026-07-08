// dag/kernels/relational.test.ts — the relational/boolean node-family contract
// (STORY-041, CAP-relational). Each `describe` maps to an acceptance criterion:
// the `> < ≥ ≤ == !=` boolean kinds exist, cross_up/cross_down carry the exact
// crossing semantics, every comparison/cross reproduces the engine truth values
// bar-for-bar (evalCondAt / evalIndRuleAt parity), boolean nodes carry level by
// their inputs, and nodes stay plain/immutable/pure.

import { describe, it, expect } from 'vitest';
import { node, source, level, type Node } from '../node.ts';
import { evaluate, type Bars, type Series } from '../eval.ts';
import { relationalKernels } from './relational.ts';
import {
  DAG_KERNELS, buildUniverse, evalCondAt, evalIndRuleAt, evalChainAt,
  type Stock, type Condition, type IndicatorDef, type IndRule, type ChainRule,
} from '../../market';
import { syntheticProvider } from '../../data/synthetic';

const NO_BARS: Bars = { o: [], h: [], l: [], c: [] };
type RelKind = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'cross_up' | 'cross_down';
const run = (kind: RelKind, inputs: Series[]): Series =>
  relationalKernels[kind]!(inputs, {}, NO_BARS);

// A handful of real instruments for the bar-for-bar parity checks.
const UNIVERSE: Stock[] = buildUniverse(syntheticProvider(7).getUniverse()).slice(0, 3);
const barsOf = (s: Stock): Bars => s.full;
const CLOSE = source('close');
const emaNode = (p: number): Node => node('ema', [CLOSE], { period: p });
const emaOperand = (length: number) => ({ kind: 'ind' as const, def: { type: 'ema', source: 'close', length } as IndicatorDef });

describe('the boolean comparison kinds exist and produce a 1/0 series (AC#7)', () => {
  it('registers gt/lt/gte/lte/eq/neq and compares element-wise', () => {
    for (const k of ['gt', 'lt', 'gte', 'lte', 'eq', 'neq'] as const) {
      expect(typeof relationalKernels[k]).toBe('function');
    }
    const a = [1, 5, 5, 3];
    const b = [2, 4, 5, 3];
    expect(run('gt', [a, b])).toEqual([0, 1, 0, 0]);
    expect(run('lt', [a, b])).toEqual([1, 0, 0, 0]);
    expect(run('gte', [a, b])).toEqual([0, 1, 1, 1]);
    expect(run('lte', [a, b])).toEqual([1, 0, 1, 1]);
    expect(run('eq', [a, b])).toEqual([0, 0, 1, 1]);
    expect(run('neq', [a, b])).toEqual([1, 1, 0, 0]);
  });

  it('a null or NaN operand yields 0 (false), never null — mirroring the engine', () => {
    const out = run('gt', [[5, null, 5], [1, 1, NaN]]);
    expect(out).toEqual([1, 0, 0]);
    expect(out).not.toContain(null); // a boolean series carries no nulls
  });

  it('neq is the exact logical complement of eq on defined operands (single source)', () => {
    const a = [100, 100.1, 100, 200];
    const b = [100, 100.0, 101, 200];
    const eq = run('eq', [a, b]);
    const neq = run('neq', [a, b]);
    expect(neq).toEqual(eq.map((v) => (v === 1 ? 0 : 1)));
  });
});

describe('cross_up / cross_down carry the exact crossing semantics (AC#8)', () => {
  it('fires only on a genuine crossing, with the previous-bar comparison', () => {
    //         i:   0     1     2     3
    const left = [1, 1, 3, 2];
    const right = [2, 2, 2, 3];
    // cross_up at i=2: prev 1<=2 and now 3>2. Nowhere else.
    expect(run('cross_up', [left, right])).toEqual([0, 0, 1, 0]);
    // cross_down at i=3: prev 3>=2 and now 2<3.
    expect(run('cross_down', [left, right])).toEqual([0, 0, 0, 1]);
  });

  it('never fires at bar 0 and treats a null previous/current operand as no-cross', () => {
    expect(run('cross_up', [[5], [1]])).toEqual([0]); // i<1 → 0 even if 5>1
    expect(run('cross_up', [[1, null, 3], [2, 2, 2]])).toEqual([0, 0, 0]); // prev null at i=2
    expect(run('cross_down', [[3, 2, null], [2, 3, 3]])).toEqual([0, 1, 0]); // current null at i=2
  });
});

describe('every comparison/cross reproduces the engine truth values bar-for-bar (AC#9)', () => {
  // Build the DAG boolean node and the equivalent engine Condition over the SAME
  // operands (EMA18 vs EMA50), then assert `series[i] === 1  ⇔  evalCondAt true`.
  const OPS: RelKind[] = ['gt', 'lt', 'gte', 'lte', 'cross_up', 'cross_down'];

  it('matches evalCondAt for every operator across the universe', () => {
    for (const stock of UNIVERSE) {
      const bars = barsOf(stock);
      const left = evaluate(emaNode(18), bars, DAG_KERNELS);
      const right = evaluate(emaNode(50), bars, DAG_KERNELS);
      for (const op of OPS) {
        const series = run(op, [left, right]);
        const cond: Condition = { left: emaOperand(18), op, right: emaOperand(50) };
        for (let i = 0; i < bars.c.length; i++) {
          expect(series[i] === 1).toBe(evalCondAt(stock, cond, i));
        }
      }
    }
  });

  it('matches evalCondAt for eq — including the all-true self-comparison case', () => {
    for (const stock of UNIVERSE) {
      const bars = barsOf(stock);
      const ema18 = evaluate(emaNode(18), bars, DAG_KERNELS);
      // eq of a series with itself is approximately-equal at every defined bar.
      const selfEq = run('eq', [ema18, ema18]);
      const cond: Condition = { left: emaOperand(18), op: 'eq', right: emaOperand(18) };
      for (let i = 0; i < bars.c.length; i++) {
        expect(selfEq[i] === 1).toBe(evalCondAt(stock, cond, i));
      }
      // and eq of two distinct EMAs still tracks evalCondAt (mostly false).
      const ema50 = evaluate(emaNode(50), bars, DAG_KERNELS);
      const crossEq = run('eq', [ema18, ema50]);
      const cond2: Condition = { left: emaOperand(18), op: 'eq', right: emaOperand(50) };
      for (let i = 0; i < bars.c.length; i++) {
        expect(crossEq[i] === 1).toBe(evalCondAt(stock, cond2, i));
      }
    }
  });

  it('reproduces null-input false parity for warm-up bars (SMA operands)', () => {
    // sma5 vs sma50: the first 49 bars carry warm-up nulls, where the engine
    // returns false. The node must emit 0 there, matching bar-for-bar.
    for (const stock of UNIVERSE) {
      const bars = barsOf(stock);
      const sma5 = evaluate(node('sma', [CLOSE], { period: 5 }), bars, DAG_KERNELS);
      const sma50 = evaluate(node('sma', [CLOSE], { period: 50 }), bars, DAG_KERNELS);
      const series = run('gt', [sma5, sma50]);
      const cond: Condition = {
        left: { kind: 'ind', def: { type: 'sma', source: 'close', length: 5 } },
        op: 'gt',
        right: { kind: 'ind', def: { type: 'sma', source: 'close', length: 50 } },
      };
      for (let i = 0; i < bars.c.length; i++) {
        expect(series[i] === 1).toBe(evalCondAt(stock, cond, i));
      }
    }
  });

  it('matches evalChainAt for gt / lt (the chain evaluator only compares gt/lt)', () => {
    for (const stock of UNIVERSE) {
      const bars = barsOf(stock);
      const left = evaluate(emaNode(18), bars, DAG_KERNELS);
      const right = evaluate(emaNode(50), bars, DAG_KERNELS);
      for (const op of ['gt', 'lt'] as const) {
        const series = run(op, [left, right]);
        const rule: ChainRule = {
          kind: 'chain',
          operands: [
            { type: 'ind', def: { type: 'ema', source: 'close', length: 18 } },
            { type: 'ind', def: { type: 'ema', source: 'close', length: 50 } },
          ],
          ops: [op],
        };
        for (let i = 0; i < bars.c.length; i++) {
          expect(series[i] === 1).toBe(evalChainAt(stock, rule, i));
        }
      }
    }
  });

  it('matches evalIndRuleAt for gt / lt / cross_up / cross_down', () => {
    for (const stock of UNIVERSE) {
      const bars = barsOf(stock);
      const left = evaluate(emaNode(18), bars, DAG_KERNELS);
      const right = evaluate(emaNode(50), bars, DAG_KERNELS);
      for (const op of ['gt', 'lt', 'cross_up', 'cross_down'] as const) {
        const series = run(op, [left, right]);
        const rule: IndRule = {
          kind: 'ind',
          left: { type: 'ema', source: 'close', length: 18 },
          op,
          rhs: { type: 'ind', def: { type: 'ema', source: 'close', length: 50 } },
        };
        for (let i = 0; i < bars.c.length; i++) {
          expect(series[i] === 1).toBe(evalIndRuleAt(stock, rule, i));
        }
      }
    }
  });
});

describe('boolean nodes carry level by their scalar inputs (AC#10)', () => {
  it('a comparison over two L1 inputs is L2, and composes upward', () => {
    expect(level(node('gt', [emaNode(18), emaNode(50)]))).toBe(2);
    expect(level(node('cross_up', [emaNode(18), emaNode(50)]))).toBe(2);
    // over an L2 algebraic input and an L0 raw source → 1 + max(2, 0) = 3
    const diff = node('sub', [emaNode(18), emaNode(50)]);
    expect(level(node('lt', [diff, CLOSE]))).toBe(3);
  });
});

describe('boolean nodes stay plain, serialisable, immutable, pure (AC#6)', () => {
  const n: Node = node('gt', [emaNode(18), emaNode(50)]);

  it('is frozen plain data and round-trips through JSON', () => {
    expect(Object.isFrozen(n)).toBe(true);
    expect(Object.isFrozen(n.inputs)).toBe(true);
    const clone = JSON.parse(JSON.stringify(n));
    expect(clone.kind).toBe('gt');
    expect(clone.inputs).toHaveLength(2);
  });

  it('the kernel does not mutate its input series', () => {
    const a = Object.freeze([1, 2, 3]) as Series;
    const b = Object.freeze([3, 2, 1]) as Series;
    const snapA = [...a];
    const snapB = [...b];
    run('gt', [a, b]);
    run('cross_up', [a, b]);
    expect([...a]).toEqual(snapA);
    expect([...b]).toEqual(snapB);
  });
});
