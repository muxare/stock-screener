// dag/node.test.ts — the DAG node-model contract (STORY-039, CAP-dag-model).
// Each `describe` block maps to an acceptance criterion of the story: plain
// serialisable data, the node-kind taxonomy, derived levels, acyclicity, structural
// identity, immutability, and engine purity.

import { describe, it, expect } from 'vitest';
import nodeSource from './node.ts?raw'; // Vite `?raw`: the module's own source, for the purity guard.
import {
  node, source, level, nodeKey, family, assertAcyclic,
  type Node, type NodeKind,
} from './node';

// Shared fixtures: the exact shapes SAD-002#2.6 pins levels for.
function emaOf(src: Node, period: number): Node {
  return node('ema', [src], { period });
}
function macdShape(): Node {
  const close = source('close');
  return node('macd', [emaOf(close, 12), emaOf(close, 26)], { signal: 9 });
}
function relVolShape(): Node {
  const volume = source('volume');
  return node('relVol', [volume, node('sma', [volume], { period: 20 })], {});
}

function forEachNode(root: Node, visit: (n: Node) => void): void {
  visit(root);
  for (const input of root.inputs) forEachNode(input, visit);
}

describe('node shape — plain serialisable data (SAD-002#6.1, AC#1)', () => {
  it('is exactly { kind, inputs, params } with no stored closures', () => {
    const macd = macdShape();
    forEachNode(macd, (n) => {
      expect(Object.keys(n).sort()).toEqual(['inputs', 'kind', 'params']);
      // No value anywhere in a node is a function (SAD-002#5.1: no closures).
      expect(typeof n.kind).toBe('string');
      for (const v of Object.values(n)) expect(typeof v).not.toBe('function');
      for (const v of Object.values(n.params)) {
        expect(['string', 'number', 'boolean']).toContain(typeof v);
      }
    });
  });

  it('round-trips through JSON, proving it is serialisable', () => {
    const macd = macdShape();
    const back = JSON.parse(JSON.stringify(macd)) as Node;
    expect(back.kind).toBe('macd');
    expect(back.inputs).toHaveLength(2);
    expect(back.inputs[0].kind).toBe('ema');
    expect(back.params.signal).toBe(9);
  });
});

describe('node-kind taxonomy (SAD-002#6.2, AC#2)', () => {
  it('represents every family of the taxonomy', () => {
    const cases: Array<[NodeKind, string]> = [
      ['close', 'raw-source'], ['volume', 'raw-source'], ['hl2', 'raw-source'],
      ['ema', 'aggregation'], ['sma', 'aggregation'], ['rsi', 'aggregation'],
      ['macd', 'composite'], ['stochrsi', 'composite'], ['relVol', 'composite'],
      ['add', 'algebraic'], ['div', 'algebraic'],
      ['gt', 'relational'], ['cross_up', 'relational'],
      ['pattern', 'pattern'],
    ];
    for (const [kind, fam] of cases) expect(family(kind)).toBe(fam);
  });
});

describe('derived level (SAD-002#2.6, AC#3 & AC#4)', () => {
  it('raw sources are level 0', () => {
    expect(level(source('close'))).toBe(0);
    expect(level(source('volume'))).toBe(0);
  });

  it('resolves known node shapes to expected levels: ema=1, macd=2, relVol=2', () => {
    expect(level(emaOf(source('close'), 20))).toBe(1);
    expect(level(macdShape())).toBe(2);
    expect(level(relVolShape())).toBe(2);
  });

  it('level is 1 + max(level of inputs), never hand-assigned', () => {
    const close = source('close');
    const ema = emaOf(close, 20);                       // L1
    const deeper = node('priceVsEma', [close, ema], {}); // 1 + max(0, 1) = 2
    expect(level(deeper)).toBe(2);
    // A node carries no own `level` field — it is purely derived.
    expect('level' in (deeper as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('acyclicity (SAD-002#6.1, AC#5)', () => {
  it('accepts a bottom-up DAG', () => {
    expect(() => assertAcyclic(macdShape())).not.toThrow();
  });

  it('rejects a construction that would introduce a cycle', () => {
    // Bottom-up construction cannot form a cycle, so force one via a raw object
    // graph and assert the guard rejects it.
    const cyclic = { kind: 'ema', inputs: [] as unknown[], params: {} };
    cyclic.inputs.push(cyclic);
    expect(() => assertAcyclic(cyclic as unknown as Node)).toThrow(/cycle/i);
  });

  it('rejects a longer back edge, not just self-reference', () => {
    const a = { kind: 'ema', inputs: [] as unknown[], params: {} };
    const b = { kind: 'macd', inputs: [a] as unknown[], params: {} };
    a.inputs.push(b); // a -> b -> a
    expect(() => assertAcyclic(a as unknown as Node)).toThrow(/cycle/i);
  });
});

describe('structural identity (SAD-002#6.1, AC#6)', () => {
  it('equal structure ⇒ equal key (dedup)', () => {
    // Two independently-built shapes: no shared object references, no instrument —
    // identity depends only on structure, so it is instrument-independent.
    expect(nodeKey(macdShape())).toBe(nodeKey(macdShape()));
    expect(nodeKey(emaOf(source('close'), 20))).toBe(nodeKey(emaOf(source('close'), 20)));
  });

  it('a change to kind, params, or inputs ⇒ a different key (invalidation)', () => {
    const base = emaOf(source('close'), 20);
    expect(nodeKey(base)).not.toBe(nodeKey(node('sma', [source('close')], { period: 20 })));      // kind
    expect(nodeKey(base)).not.toBe(nodeKey(emaOf(source('close'), 50)));                          // params
    expect(nodeKey(base)).not.toBe(nodeKey(emaOf(source('open'), 20)));                           // inputs
  });

  it('is stable regardless of param insertion order', () => {
    const a = node('macd', [emaOf(source('close'), 12), emaOf(source('close'), 26)], { fast: 12, slow: 26 });
    const b = node('macd', [emaOf(source('close'), 12), emaOf(source('close'), 26)], { slow: 26, fast: 12 });
    expect(nodeKey(a)).toBe(nodeKey(b));
  });

  it('does not collide when a param value contains a delimiter character', () => {
    // A one-param value carrying `,`/`=` must not alias a genuinely two-param node.
    const one = node('gt', [source('close')], { a: '1,b=2' });
    const two = node('gt', [source('close')], { a: '1', b: '2' });
    expect(nodeKey(one)).not.toBe(nodeKey(two));
  });

  it('distinguishes a param by scalar type (20 vs "20")', () => {
    const numeric = node('ema', [source('close')], { period: 20 });
    const stringy = node('ema', [source('close')], { period: '20' });
    expect(nodeKey(numeric)).not.toBe(nodeKey(stringy));
  });
});

describe('immutability (SAD-002#5.1, AC#7)', () => {
  it('freezes the node, its inputs array, and its params', () => {
    const n = emaOf(source('close'), 20);
    expect(Object.isFrozen(n)).toBe(true);
    expect(Object.isFrozen(n.inputs)).toBe(true);
    expect(Object.isFrozen(n.params)).toBe(true);
  });

  it('rejects mutation after construction', () => {
    'use strict';
    const n = source('close');
    expect(() => { (n as unknown as { kind: string }).kind = 'open'; }).toThrow();
    expect(() => { (n.params as Record<string, unknown>).period = 5; }).toThrow();
  });
});

describe('construction contract (SAD-002#6.2)', () => {
  it('rejects raw sources given inputs, and non-raw kinds given none', () => {
    expect(() => node('close', [source('open')], {})).toThrow(/no inputs/i);
    expect(() => node('ema', [], { period: 20 })).toThrow(/at least one input/i);
  });
});

describe('engine purity (SAD-002#2.2, AC#8)', () => {
  it('imports nothing from React/DOM/Node and uses no fetch/global/"today"', () => {
    // Strip line comments so prose ("no 'today'") can't trip the guards.
    const code = nodeSource.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/from\s+['"](react|react-dom|react\/|node:|fs|path)/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bnew\s+Date\b|\bDate\s*\.\s*now\b/);
    expect(code).not.toMatch(/\bMath\s*\.\s*random\b/);
    expect(code).not.toMatch(/\b(window|document|globalThis|process)\b/);
  });
});
