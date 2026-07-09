// dag/lower.test.ts — the indicator lowering layer contract (STORY-043,
// CAP-dag-lower). Each `describe` maps to an acceptance criterion: the source
// mapping reuses raw-source kinds; ema/sma/rsi/macd/stochrsi/price lower to graphs
// of existing kinds; and every lowered def evaluates bar-for-bar identical to the
// old `indSeries` path across the fixture universe (SAD-002#5.3, #2.1). The
// cross-cutting universe-wide fidelity GATE lives in fidelity.test.ts; this file is
// the unit-level structural + parity contract for `lowerIndicator`.

import { describe, it, expect } from 'vitest';
import { lowerIndicator } from './lower.ts';
import { node, source, nodeKey, level, type Node } from './node.ts';
import {
  buildUniverse, indSeries, evalDagNode, newDef,
  type Stock, type IndicatorDef,
} from '../market';
import { syntheticProvider } from '../data/synthetic';

// A multi-instrument synthetic universe (44 tickers × 260 bars, deterministic),
// built once and reused read-only — the parity checks run every bar of every one.
const UNIVERSE: Stock[] = buildUniverse(syntheticProvider().getUniverse());

/** Assert a lowered def evaluates bar-for-bar identical to indSeries across the universe. */
function expectParity(def: IndicatorDef): void {
  const lowered = lowerIndicator(def);
  for (const s of UNIVERSE) {
    expect(evalDagNode(s, lowered)).toEqual(indSeries(s, def));
  }
}

describe('source mapping reuses raw-source kinds (SAD-002#5.3, AC#3)', () => {
  it('maps every recognised source to the same-named raw-source node', () => {
    for (const src of ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3'] as const) {
      expect(lowerIndicator({ type: 'price', source: src })).toEqual(source(src));
    }
  });

  it('defaults an absent or unknown source to close (mirroring srcArr)', () => {
    expect(lowerIndicator({ type: 'price' })).toEqual(source('close'));
    expect(lowerIndicator({ type: 'price', source: 'bogus' })).toEqual(source('close'));
  });
});

describe('price lowers to a raw source (AC#1)', () => {
  it('is bar-for-bar identical to indSeries for every source', () => {
    for (const src of ['close', 'open', 'high', 'low', 'volume', 'hl2', 'hlc3']) {
      expectParity({ type: 'price', source: src });
    }
  });
});

describe('ema/sma/rsi lower to the aggregation node over the source (AC#1)', () => {
  it('lowers to the existing aggregation kind with { period: length }', () => {
    expect(lowerIndicator({ type: 'ema', source: 'close', length: 21 }))
      .toEqual(node('ema', [source('close')], { period: 21 }));
    expect(lowerIndicator({ type: 'sma', source: 'volume', length: 50 }))
      .toEqual(node('sma', [source('volume')], { period: 50 }));
    expect(lowerIndicator({ type: 'rsi', source: 'hlc3', length: 14 }))
      .toEqual(node('rsi', [source('hlc3')], { period: 14 }));
  });

  it('coerces a string length param to a number (mirroring indSeries `+`)', () => {
    expect(lowerIndicator({ type: 'ema', source: 'close', length: '9' }))
      .toEqual(node('ema', [source('close')], { period: 9 }));
  });

  it('is bar-for-bar identical to indSeries across sources and lengths', () => {
    for (const type of ['ema', 'sma', 'rsi'] as const) {
      for (const source of ['close', 'hl2', 'hlc3', 'volume']) {
        for (const length of [7, 14, 50, 200]) {
          expectParity({ type, source, length });
        }
      }
    }
  });
});

describe('macd lowers to a graph of existing kinds — ema + algebraic sub (ADR-004, AC#2)', () => {
  const def = { ...newDef('macd'), source: 'close', fast: 12, slow: 26, signal: 9 };

  it('line = sub(ema(src, fast), ema(src, slow)) — no macd kernel, so macd stays reserved', () => {
    const line = lowerIndicator({ ...def, output: 'line' });
    const expected = node('sub', [
      node('ema', [source('close')], { period: 12 }),
      node('ema', [source('close')], { period: 26 }),
    ]);
    expect(nodeKey(line)).toEqual(nodeKey(expected));
    // The whole graph is existing kinds only — never the reserved composite `macd`.
    expect(kindsIn(line)).not.toContain('macd');
  });

  it('signal is an EMA of the macd line — the same ema the engine uses for the signal', () => {
    const signal = lowerIndicator({ ...def, output: 'signal' });
    expect(signal.kind).toBe('ema');
    expect(signal.params.period).toBe(9);
    expect(nodeKey(signal.inputs[0])).toEqual(nodeKey(lowerIndicator({ ...def, output: 'line' })));
  });

  it('hist = sub(line, signal)', () => {
    const hist = lowerIndicator({ ...def, output: 'hist' });
    expect(hist.kind).toBe('sub');
    expect(kindsIn(hist)).not.toContain('macd');
  });

  it('is bar-for-bar identical to indSeries for line/signal/hist and default output', () => {
    for (const output of ['line', 'signal', 'hist', undefined]) {
      expectParity({ ...def, output });
    }
  });

  it('default output lowers to the line (matching indSeries)', () => {
    expect(nodeKey(lowerIndicator({ ...def, output: undefined })))
      .toEqual(nodeKey(lowerIndicator({ ...def, output: 'line' })));
  });
});

describe('stochrsi lowers via the composite normalisation kernel + sma smoothing (AC#2)', () => {
  const def = { ...newDef('stochrsi'), source: 'close', rsiLen: 14, stochLen: 14, kSmooth: 3, dSmooth: 3 };

  it('k = sma(stochrsi(rsi(src, rsiLen), stochLen), kSmooth)', () => {
    const k = lowerIndicator({ ...def, output: 'k' });
    const expected = node('sma', [
      node('stochrsi', [node('rsi', [source('close')], { period: 14 })], { period: 14 }),
    ], { period: 3 });
    expect(nodeKey(k)).toEqual(nodeKey(expected));
  });

  it('d = sma(k, dSmooth) — one further sma over %K', () => {
    const d = lowerIndicator({ ...def, output: 'd' });
    expect(d.kind).toBe('sma');
    expect(d.params.period).toBe(3);
    expect(nodeKey(d.inputs[0])).toEqual(nodeKey(lowerIndicator({ ...def, output: 'k' })));
    // The rolling min/max normalisation is the one genuine composite kernel used.
    expect(kindsIn(d)).toContain('stochrsi');
  });

  it('is bar-for-bar identical to indSeries for k/d and default output, across lengths', () => {
    for (const output of ['k', 'd', undefined]) {
      for (const stochLen of [7, 14, 21]) {
        for (const [kSmooth, dSmooth] of [[3, 3], [1, 1], [5, 2]]) {
          expectParity({ ...def, output, stochLen, kSmooth, dSmooth });
        }
      }
    }
  });

  it('default output lowers to %K (matching indSeries)', () => {
    expect(nodeKey(lowerIndicator({ ...def, output: undefined })))
      .toEqual(nodeKey(lowerIndicator({ ...def, output: 'k' })));
  });
});

describe('lowering is pure and isomorphic (SAD-002#2.2)', () => {
  it('returns an equal graph for equal input, and never mutates the def', () => {
    const def: IndicatorDef = { type: 'macd', source: 'close', fast: 12, slow: 26, signal: 9, output: 'signal' };
    const before = JSON.stringify(def);
    const a = lowerIndicator(def);
    const b = lowerIndicator(def);
    expect(nodeKey(a)).toEqual(nodeKey(b));
    expect(JSON.stringify(def)).toEqual(before); // def untouched
  });

  it('produces nodes whose level is derived, not hand-assigned (a real DAG)', () => {
    // macd hist sits above two emas and the line: at least level 2.
    expect(level(lowerIndicator({ type: 'macd', source: 'close', fast: 12, slow: 26, signal: 9, output: 'hist' })))
      .toBeGreaterThanOrEqual(2);
  });
});

/** Collect the distinct node kinds reachable from `n` (for "graph of existing kinds" checks). */
function kindsIn(n: Node): string[] {
  const seen = new Set<string>();
  const walk = (m: Node): void => {
    seen.add(m.kind);
    for (const input of m.inputs) walk(input);
  };
  walk(n);
  return [...seen];
}
