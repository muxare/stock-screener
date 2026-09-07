import { describe, it, expect } from 'vitest';
import {
  backtestFanUniverse,
  findFanEntries,
  macd1850,
  isLongReversal,
  isBunnLongReversal,
  isLongPivotCandidate,
  longPivotConfirmBar,
  lastConfirmedPivotLow,
  isMaBounce,
  crossUp18_50,
  crossDown18_50,
  DEFAULT_FAN_BACKTEST_CONFIG,
  explainFanTrade,
  tradeChartRange,
  fullFanUp,
  slowFanUp,
  fanEntryIndex,
  correlateFanFactors,
  emptyFanAccountResult,
  addCalendarMonths,
  simulateFanAccount,
  type FanBacktestConfig,
  type FanEntryEvent,
  type FanTradeExitReason,
} from './fanBacktest.ts';
import { presetById } from './strategy/presets.ts';
import { ema } from './indicators.ts';

const onsetDef = presetById('onset');
const onset: FanBacktestConfig = {
  ...DEFAULT_FAN_BACKTEST_CONFIG,
  strategy: { ...onsetDef, trade: { ...onsetDef.trade, exit: { ...onsetDef.trade.exit, trailEma: null, maxHoldBars: 60 } } },
  horizons: [5, 10],
};

function rampSeries(flatBars: number, rampBars: number, flat = 10, step = 0.45): number[] {
  return [
    ...Array(flatBars).fill(flat),
    ...Array.from({ length: rampBars }, (_, i) => flat + (i + 1) * step),
  ];
}

describe('macd1850 / reversal helpers', () => {
  it('builds 18-50 MACD as EMA18 minus EMA50', () => {
    const c = rampSeries(80, 40);
    const e18 = ema(c, 18);
    const e50 = ema(c, 50);
    const m = macd1850(e18, e50);
    const i = c.length - 1;
    expect(m.line[i]).toBeCloseTo(e18[i] - e50[i], 8);
    expect(m.hist[i]).toBeCloseTo(m.line[i] - m.signal[i], 8);
  });

  it('detects a 2-bar long reversal', () => {
    const o = [10, 9, 8.5];
    const h = [11, 9.5, 9.2];
    const c = [9.2, 8.7, 9.0];
    expect(isLongReversal(o, h, c, 2)).toBe(true);
    expect(isLongReversal(o, h, c, 1)).toBe(false);
  });

  it('detects 18/50 cross up', () => {
    expect(crossUp18_50([1, 3], [2, 2], 1)).toBe(true);
    expect(crossUp18_50([3, 4], [2, 2], 1)).toBe(false);
  });

  it('detects 18/50 cross down', () => {
    expect(crossDown18_50([3, 1], [2, 2], 1)).toBe(true);
    expect(crossDown18_50([1, 0], [2, 2], 1)).toBe(false);
  });

  it('detects a rejection bounce off an MA', () => {
    const o = [10, 9.6];
    const h = [10.2, 9.9];
    const l = [9.7, 9.2];
    const c = [9.8, 9.85];
    const ma = [9.0, 9.4];
    expect(isMaBounce(o, h, l, c, ma, 1)).toBe(true);
    expect(isMaBounce(o, h, l, c, ma, 0)).toBe(false);
  });

  it('detects a Bunn long reversal: body above the EMA, tail through it and the prior low', () => {
    expect(isBunnLongReversal([10, 10.2], [9.5, 9.0], [10.1, 10.4], [9.8, 9.7], 1)).toBe(true);
  });

  it('rejects a Bunn reversal when the body is not fully above the EMA', () => {
    expect(isBunnLongReversal([10, 9.5], [9.4, 9.0], [9.8, 10.2], [9.6, 9.7], 1)).toBe(false);
  });

  it('rejects a Bunn reversal whose tail does not undercut the prior low', () => {
    expect(isBunnLongReversal([10, 10.2], [9.0, 9.2], [10.1, 10.4], [9.8, 9.7], 1)).toBe(false);
  });
});

describe('confirmed long pivots', () => {
  it('is a candidate when previous and subsequent lows are higher', () => {
    const l = [10, 9, 10];
    expect(isLongPivotCandidate(l, 1)).toBe(true);
    expect(isLongPivotCandidate(l, 0)).toBe(false);
    expect(isLongPivotCandidate(l, 2)).toBe(false);
  });

  it('confirms on the first later high that strictly exceeds the prior high', () => {
    const l = [10, 9, 10, 10.2, 10.4];
    const h = [11, 9.5, 10.5, 11, 11.01];
    expect(longPivotConfirmBar(h, l, 1, 0)).toBe(4);
    const equal = [11, 9.5, 10.5, 11, 11];
    expect(longPivotConfirmBar(equal, l, 1, 0)).toBeNull();
  });

  it('returns the pivot low only after confirmation', () => {
    const l = [10, 9, 10, 10.2, 10.4];
    const h = [11, 9.5, 10.5, 11, 11.01];
    expect(lastConfirmedPivotLow(h, l, 3)).toBeNull();
    expect(lastConfirmedPivotLow(h, l, 4)).toBe(9);
    expect(lastConfirmedPivotLow(h, l, 4, 4)).toBeNull();
    expect(lastConfirmedPivotLow(h, l, 4, 3)).toBe(9);
  });
});

describe('DEFAULT_FAN_BACKTEST_CONFIG', () => {
  it('defaults to the 50-EMA tag preset, trail 50, MACD off', () => {
    const d = DEFAULT_FAN_BACKTEST_CONFIG;
    expect(d.strategy.id).toBe('tag50');
    expect(d.strategy.builtin).toBe(true);
    expect(d.strategy.trade.exit.trailEma).toBe(50);
    expect(d.strategy.trade.exit.targetWindow).toBe(false);
    expect(d.strategy.trade.exit.trailPivot).toBe(false);
    expect(d.strategy.trade.exit.macdExit).toBe(false);
    expect(d.strategy.trade.exit.breakevenAtR).toBe(1);
    expect(d.strategy.trade.stop.atrPad).toBe(0.25);
    expect(d.ema200RisingBars).toBe(21);
    expect(d.startCash).toBe(10_000);
    expect(d.riskPct).toBe(1);
    expect(d.maxPositions).toBe(4);
    expect(d.windowMonths).toBe(3);
  });
});

describe('backtestFanUniverse', () => {
  it('aggregates onset entries across subjects', () => {
    const res = backtestFanUniverse([
      { ticker: 'A', name: 'A', closes: rampSeries(200, 90) },
      { ticker: 'B', name: 'B', closes: rampSeries(200, 90, 20, 0.35) },
    ], { ...onset, horizons: [5] });
    expect(res.totalEntries).toBeGreaterThan(0);
    expect(res.forwardHorizons[0].n).toBeGreaterThan(0);
    expect(res.forwardHorizons[0].n).toBeLessThanOrEqual(res.totalEntries);
    expect(res.account.startCash).toBe(10_000);
    expect(res.trades.count).toBeGreaterThan(0);
  });

  it('findFanEntries is the engine alias', () => {
    expect(findFanEntries({ ticker: 'A', name: 'A', closes: rampSeries(200, 90) }, onset).length).toBeGreaterThan(0);
  });
});

function sampleEvent(over: Partial<FanEntryEvent> = {}, reason: FanTradeExitReason = 'trail'): FanEntryEvent {
  return {
    ticker: 'XLNX',
    name: 'Xilinx',
    date: '2017-09-07',
    barIndex: 40,
    strategyId: 'tag50',
    strategyName: '50-EMA tag',
    entryMode: 'close',
    summary: '18 crossed up through 50 while 50 > 100 > 200 held → pullback tagged the 50-EMA and closed back above it; buy the trigger close.',
    entryPrice: 64.32,
    worstGap: 0.01,
    forwardReturns: {},
    trade: {
      entryBar: 40, exitBar: 48, entryPrice: 64.32, exitPrice: 69.17,
      stopPrice: 62.8, targetPrice: 68.88, returnPct: 7.54, realizedR: 4.38,
      barsHeld: 8, maxFavorablePct: 8.1, maxAdversePct: -0.9, exitReason: reason,
    },
    marks: [
      { stepId: 'cross', stepIndex: 0, kind: 'candle', label: 'cross ↑', bar: 32, price: 60 },
      { stepId: 'swing', stepIndex: 1, kind: 'tracker', label: 'high', bar: 36, price: 66 },
      { stepId: 'tag', stepIndex: 2, kind: 'candle', label: 'tag 50', bar: 40, price: 63 },
    ],
    fanBar: 32,
    reactionBar: 40,
    impulseBar: 36,
    indicators: null,
    ...over,
  };
}

describe('explainFanTrade', () => {
  it('names a trail exit and restates the 50-EMA tag entry', () => {
    const s = explainFanTrade(sampleEvent());
    expect(s.headline).toMatch(/Trailed out/);
    expect(s.headline).toMatch(/\+4\.38R/);
    expect(s.entry).toMatch(/2017-09-07/);
    expect(s.entry).toMatch(/50-EMA/);
    expect(s.entry).toMatch(/8 bars earlier/);
    expect(s.exit).toMatch(/50-EMA/);
    expect(s.excursion).toMatch(/8 bar/);
  });

  it('warns that end-of-data R is mark-to-market', () => {
    const s = explainFanTrade(sampleEvent({}, 'end_of_data'));
    expect(s.headline).toMatch(/Still open/);
    expect(s.exit).toMatch(/mark-to-market/);
  });

  it('handles a signal with no simulated fill', () => {
    const s = explainFanTrade(sampleEvent({ trade: null }));
    expect(s.headline).toMatch(/without a simulated trade/);
    expect(s.excursion).toBeNull();
  });

  it('describes a buy-stop fill with the strategy summary', () => {
    const s = explainFanTrade(sampleEvent({
      entryMode: 'buy_stop',
      summary: '50 > 100 > 200 stacked (held) → Bunn reversal on the 50, 100, or 200; buy stop 0.02 above the trigger high.',
      fanBar: 39, reactionBar: 39, impulseBar: 39,
      marks: [{ stepId: 'reversal', stepIndex: 1, kind: 'candle', label: 'reversal', bar: 39, price: 60 }],
    }));
    expect(s.entry).toMatch(/buy stop/i);
    expect(s.entry).toMatch(/50, 100, or 200/);
    expect(s.entry).toMatch(/1 bar earlier \(reversal\)/);
  });

  it('describes a pivot-trail exit', () => {
    const s = explainFanTrade(sampleEvent({}, 'pivot_trail'));
    expect(s.headline).toMatch(/pivot/i);
    expect(s.exit).toMatch(/pivot/i);
  });
});

describe('fullFanUp', () => {
  it('is 18 > 50 > 100 > 200', () => {
    expect(fullFanUp([4], [3], [2], [1], 0)).toBe(true);
    expect(fullFanUp([3], [3.1], [2], [1], 0)).toBe(false);
    expect(slowFanUp([3], [2], [1], 0)).toBe(true);
  });
});

describe('tradeChartRange', () => {
  it('pads before entry and after exit, clamped to the series', () => {
    expect(tradeChartRange(10, 20, 100, 5, 3)).toEqual({ from: 5, to: 23 });
    expect(tradeChartRange(2, 4, 10, 30, 15)).toEqual({ from: 0, to: 9 });
  });

  it('defaults to 80 bars before entry and 20 after exit', () => {
    expect(tradeChartRange(100, 110, 200)).toEqual({ from: 20, to: 130 });
  });

  it('expands left to include a mark outside the default pad', () => {
    expect(tradeChartRange(100, 110, 200, 10, 5, [50])).toEqual({ from: 42, to: 115 });
  });

  it('clamps a far-away held mark to 160 bars before the entry', () => {
    expect(tradeChartRange(500, 510, 1000, 10, 5, [20])).toEqual({ from: 340, to: 515 });
  });
});

describe('fanEntryIndex', () => {
  it('finds the event in a list by ticker, bar, and date', () => {
    const a = sampleEvent({ ticker: 'AAA', barIndex: 1, date: '2016-01-01' });
    const b = sampleEvent({ ticker: 'BBB', barIndex: 2, date: '2016-01-02' });
    expect(fanEntryIndex([a, b], b)).toBe(1);
    expect(fanEntryIndex([a, b], sampleEvent({ ticker: 'ZZZ', barIndex: 9, date: '2016-01-01' }))).toBe(-1);
  });
});

describe('universe volume and market-cap filters', () => {
  it('skips names below the same floors as the main filter bar', () => {
    const closes = rampSeries(200, 90);
    const fat = { ticker: 'FAT', name: 'Fat', closes, avgVol20: 2e6, marketCap: 5e9 };
    const thin = { ticker: 'THIN', name: 'Thin', closes, avgVol20: 1_000, marketCap: 5e9 };
    const micro = { ticker: 'MIC', name: 'Micro', closes, avgVol20: 2e6, marketCap: 1e6 };
    const unknown = { ticker: 'UNK', name: 'Unk', closes, avgVol20: 2e6, marketCap: null as number | null };
    const cfg: FanBacktestConfig = { ...onset, minAvgVol: 250_000, minMarketCap: 1e9 };
    const res = backtestFanUniverse([fat, thin, micro, unknown], cfg);
    expect(res.universe).toBe(4);
    expect(res.stocksScanned).toBe(1);
    expect(res.entries.every((e) => e.ticker === 'FAT')).toBe(true);
  });
});

describe('correlateFanFactors', () => {
  it('buckets win rate and avg R by MACD hist and Stoch zone', () => {
    const win = sampleEvent({
      indicators: { macdLine: 1, macdSignal: 0.5, macdHist: 0.4, stochK: 25, stochD: 20 },
    });
    const loss = sampleEvent({
      ticker: 'LOSS',
      trade: { ...sampleEvent().trade!, realizedR: -1, returnPct: -2, exitReason: 'stop_r' },
      indicators: { macdLine: -0.2, macdSignal: 0.1, macdHist: -0.3, stochK: 85, stochD: 90 },
    });
    const factors = correlateFanFactors([win, loss]);
    const histPos = factors.find((f) => f.factor === 'MACD hist' && f.bucket === '> 0');
    const histNeg = factors.find((f) => f.factor === 'MACD hist' && f.bucket === '≤ 0');
    expect(histPos?.n).toBe(1);
    expect(histPos?.winRate).toBe(100);
    expect(histNeg?.n).toBe(1);
    expect(histNeg?.avgR).toBe(-1);
    const overbought = factors.find((f) => f.factor === 'Stoch RSI %K' && f.bucket === '> 80');
    expect(overbought?.n).toBe(1);
  });
});

function datesEnding(n: number, endIso = '2026-06-19'): string[] {
  const [y, m, d] = endIso.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

function cashEvent(over: {
  ticker: string;
  date: string;
  exitDate: string;
  entryPrice?: number;
  stopPrice?: number;
  exitPrice?: number;
}): FanEntryEvent {
  const entryPrice = over.entryPrice ?? 100;
  const stopPrice = over.stopPrice ?? 98;
  const exitPrice = over.exitPrice ?? 98;
  const rSize = entryPrice - stopPrice;
  return sampleEvent({
    ticker: over.ticker,
    name: over.ticker,
    date: over.date,
    entryPrice,
    trade: {
      entryBar: 1, exitBar: 3, entryPrice, exitPrice, stopPrice, targetPrice: entryPrice + 3 * rSize,
      returnPct: ((exitPrice - entryPrice) / entryPrice) * 100,
      realizedR: rSize > 0 ? (exitPrice - entryPrice) / rSize : 0,
      barsHeld: 2, maxFavorablePct: 1, maxAdversePct: -1, exitReason: exitPrice < entryPrice ? 'stop_r' : 'trail',
      exitDate: over.exitDate,
    },
  });
}

describe('addCalendarMonths', () => {
  it('subtracts months across a year boundary', () => {
    expect(addCalendarMonths('2026-06-19', -3)).toBe('2026-03-19');
    expect(addCalendarMonths('2026-01-31', -1)).toBe('2025-12-31');
  });
});

describe('simulateFanAccount', () => {
  const book: FanBacktestConfig = {
    ...DEFAULT_FAN_BACKTEST_CONFIG,
    startCash: 10_000,
    riskPct: 1,
    maxPositions: 4,
    windowMonths: 0,
  };

  it('realizes a 1R loss as about 1% of equity', () => {
    const acc = simulateFanAccount([
      cashEvent({ ticker: 'AAA', date: '2016-01-04', exitDate: '2016-01-10', entryPrice: 100, stopPrice: 98, exitPrice: 98 }),
    ], book, '2016-06-01');
    expect(acc.taken).toBe(1);
    expect(acc.endEquity).toBe(9_900);
    expect(acc.returnPct).toBeCloseTo(-1);
    expect(acc.fills[0].shares).toBe(50);
    expect(acc.fills[0].pnl).toBe(-100);
  });

  it('caps concurrent names and skips the rest of that day', () => {
    const same = ['AAA', 'BBB', 'CCC'].map((t) =>
      cashEvent({ ticker: t, date: '2016-01-04', exitDate: '2016-01-20', entryPrice: 100, stopPrice: 98, exitPrice: 101 }),
    );
    const acc = simulateFanAccount(same, { ...book, maxPositions: 1 }, '2016-06-01');
    expect(acc.taken).toBe(1);
    expect(acc.fills[0].event.ticker).toBe('AAA');
    expect(acc.skipped.maxPositions).toBe(2);
  });

  it('redeploys cash after an exit on the same day', () => {
    const acc = simulateFanAccount([
      cashEvent({ ticker: 'AAA', date: '2016-01-04', exitDate: '2016-01-10', entryPrice: 100, stopPrice: 98, exitPrice: 101 }),
      cashEvent({ ticker: 'BBB', date: '2016-01-10', exitDate: '2016-01-20', entryPrice: 100, stopPrice: 98, exitPrice: 101 }),
    ], { ...book, maxPositions: 1 }, '2016-06-01');
    expect(acc.taken).toBe(2);
  });

  it('keeps only fills inside the last N months', () => {
    const acc = simulateFanAccount([
      cashEvent({ ticker: 'OLD', date: '2016-01-04', exitDate: '2016-01-10' }),
      cashEvent({ ticker: 'NEW', date: '2017-04-03', exitDate: '2017-04-10' }),
    ], { ...book, windowMonths: 3 }, '2017-06-01');
    expect(acc.windowStart).toBe('2017-03-01');
    expect(acc.candidates).toBe(1);
    expect(acc.fills[0].event.ticker).toBe('NEW');
  });

  it('stops at ruin when a full-size loss zeros the book', () => {
    const acc = simulateFanAccount([
      cashEvent({ ticker: 'ZRO', date: '2016-01-04', exitDate: '2016-01-10', entryPrice: 100, stopPrice: 1, exitPrice: 0 }),
      cashEvent({ ticker: 'LAT', date: '2016-01-20', exitDate: '2016-01-28', entryPrice: 100, stopPrice: 98, exitPrice: 101 }),
    ], { ...book, startCash: 100, riskPct: 100 }, '2016-06-01');
    expect(acc.endReason).toBe('ruin');
    expect(acc.endEquity).toBe(0);
    expect(acc.taken).toBe(1);
  });

  it('returns an empty book when entries have no calendar dates', () => {
    const acc = simulateFanAccount([sampleEvent({ date: null })], book, null);
    expect(acc).toEqual(emptyFanAccountResult(10_000));
    expect(acc.taken).toBe(0);
  });
});

describe('account overlay over engine fills', () => {
  it('takes dated ramp fills when the window is all history', () => {
    const closes = rampSeries(200, 90);
    const dates = datesEnding(closes.length);
    const res = backtestFanUniverse(
      [{ ticker: 'A', name: 'A', closes, dates }],
      { ...onset, windowMonths: 0, startCash: 10_000, riskPct: 1, maxPositions: 4 },
    );
    expect(res.account.taken).toBeGreaterThan(0);
    expect(res.account.windowEnd).toBe('2026-06-19');
  });
});
