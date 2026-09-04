// engine.golden.test.ts — golden-master fidelity harness (STORY-020).
//
// Enforces numeric fidelity (highest priority): every indicator function in
// `src/lib/indicators.ts` is pinned bar-for-bar to its trusted output over a
// FIXED deterministic series. The synthetic adapter reproduces the original POC
// generator's RNG call order exactly, so the fixtures below ARE the POC values.
//
// The committed `__snapshots__/engine.golden.test.ts.snap` file is the golden
// master. Any divergence in indicator math fails `npm test`, and therefore CI.
// Do NOT run `vitest -u` to "fix" a failure here: a diff means the numbers
// changed, which is the exact regression this harness exists to catch (never
// change smoothing or rounding silently).

import { describe, it, expect } from 'vitest';
import { ema, sma, rsi, stochRsi, macd } from '../src/lib/indicators';
import { syntheticProvider } from '../src/lib/data/synthetic';

// ---- fixed deterministic fixture series (from the STORY-014 synthetic adapter) ----
// seed 7 is the adapter's default; the universe is fully reproducible.
const UNIVERSE = syntheticProvider(7).getUniverse();

// One representative instrument drives the indicator + per-bar fixtures.
const AAPL = UNIVERSE[0];
const closes = AAPL.bars.map(b => b.c);
const vols = AAPL.bars.map(b => b.v);

describe('fixture determinism', () => {
  it('synthetic adapter yields the pinned series shape', () => {
    expect(UNIVERSE.length).toBe(44);
    expect(AAPL.ticker).toBe('AAPL');
    expect(closes.length).toBe(260);
    // pin the raw series so an upstream generator change is also caught
    expect({ closes, vols }).toMatchSnapshot();
  });
});

describe('indicator math (SAD#2.1) — pinned bar-for-bar', () => {
  it('ema', () => {
    expect(ema(closes, 9)).toMatchSnapshot();
    expect(ema(closes, 20)).toMatchSnapshot();
    expect(ema(closes, 50)).toMatchSnapshot();
    expect(ema(closes, 200)).toMatchSnapshot();
  });

  it('sma (volume average)', () => {
    expect(sma(vols, 20)).toMatchSnapshot();
  });

  it('rsi (Wilder smoothing)', () => {
    expect(rsi(closes, 14)).toMatchSnapshot();
  });

  it('stochRsi', () => {
    expect(stochRsi(rsi(closes, 14), 14, 3, 3)).toMatchSnapshot();
  });

  it('macd', () => {
    expect(macd(closes)).toMatchSnapshot();
  });
});
