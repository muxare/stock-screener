// engine.golden.test.ts — golden-master fidelity harness (STORY-020).
//
// Enforces SAD#2.1 (numeric fidelity, highest priority): every engine function
// is pinned bar-for-bar to its trusted output over a FIXED deterministic series.
// Per ADR-002 (SAD#8.2) the engine in `src/lib/market.ts` is the verbatim POC
// port, and per ADR-007 the synthetic adapter (STORY-014) reproduces the POC
// generator's RNG call order exactly — so the fixtures below ARE the POC values.
//
// The committed `__snapshots__/engine.golden.test.ts.snap` file is the golden
// master. Any divergence in indicator math, rule grouping, the PCF dialect, or
// the backtest fails `npm test`, and therefore CI. Do NOT run `vitest -u` to
// "fix" a failure here: a diff means the engine's numbers changed, which is the
// exact regression this harness exists to catch (SAD#5.1: never change smoothing
// or rounding).

import { describe, it, expect } from 'vitest';
import {
  ema,
  sma,
  rsi,
  stochRsi,
  macd,
  buildUniverse,
  evalGroupedRules,
  parsePCF,
  backtestRules,
  type Rule,
  type Stock,
} from '../src/lib/market';
import { syntheticProvider } from '../src/lib/data/synthetic';

// ---- fixed deterministic fixture series (from the STORY-014 synthetic adapter) ----
// seed 7 is the adapter's default; the universe is fully reproducible.
const UNIVERSE = syntheticProvider(7).getUniverse();
const stocks: Stock[] = buildUniverse(UNIVERSE);

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

describe('rule engine — evalGroupedRules (SAD#5.1) — pinned bar-for-bar', () => {
  // Pure AND chain: RSI oversold AND long-term uptrend.
  const andRules: Rule[] = [
    { kind: 'num', field: 'rsi', op: 'lt', value: 35 },
    { kind: 'flag', field: 'ema50Above200' },
  ];
  // AND/OR mix: (RSI > 70 OR RSI < 30) AND MACD bullish cross.
  const orRules: Rule[] = [
    { kind: 'num', field: 'rsi', op: 'gt', value: 70 },
    { kind: 'num', field: 'rsi', op: 'lt', value: 30, conj: 'or' },
    { kind: 'flag', field: 'macdCrossUp' },
  ];

  it('evaluates every bar of the representative stock', () => {
    const stock = stocks[0];
    const andSeries = stock.full.c.map((_, i) => evalGroupedRules(stock, andRules, i));
    const orSeries = stock.full.c.map((_, i) => evalGroupedRules(stock, orRules, i));
    expect({ andSeries, orSeries }).toMatchSnapshot();
  });

  it('evaluates the whole universe at the latest bar', () => {
    const andLatest = stocks.map(s => [s.ticker, evalGroupedRules(s, andRules)]);
    const orLatest = stocks.map(s => [s.ticker, evalGroupedRules(s, orRules)]);
    expect({ andLatest, orLatest }).toMatchSnapshot();
  });
});

describe('PCF parser — parsePCF (SAD#5.1) — pinned dialect', () => {
  const cases = [
    'C > XAVGC50',
    'C > XAVGC50 AND C < XAVGC200',
    'RSI(14) < 30 OR RSI(14) > 70',
    'XAVGC9 > XAVGC20 AND V > AVGV20',
    'C >= XAVGC50',
    'C <> XAVGC50',
    '',                       // empty -> error
    'this is not a formula',  // unreadable -> error
  ];

  it('parses each formula to its pinned result', () => {
    const parsed = cases.map(text => [text, parsePCF(text)]);
    expect(parsed).toMatchSnapshot();
  });
});

describe('backtest — backtestRules (SAD#2.1) — pinned aggregate', () => {
  it('produces the pinned result over the fixed universe', () => {
    const rules: Rule[] = [
      { kind: 'num', field: 'rsi', op: 'lt', value: 35 },
      { kind: 'flag', field: 'ema50Above200' },
    ];
    expect(backtestRules(stocks, rules)).toMatchSnapshot();
    // a second rule set exercising the AND/OR grouping path through the backtest
    const grouped: Rule[] = [
      { kind: 'num', field: 'rsi', op: 'gt', value: 70 },
      { kind: 'num', field: 'rsi', op: 'lt', value: 30, conj: 'or' },
    ];
    expect(backtestRules(stocks, grouped, [5, 10, 20])).toMatchSnapshot();
  });
});
