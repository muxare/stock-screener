import { describe, it, expect } from 'vitest';
import {
  findFanEntries,
  simulateRTrade,
  backtestFanUniverse,
  macd1850,
  isLongReversal,
  isBunnLongReversal,
  isLongPivotCandidate,
  longPivotConfirmBar,
  lastConfirmedPivotLow,
  isMaBounce,
  crossUp18_50,
  crossDown18_50,
  BUNN_PENNY,
  BUNN_WINDOW_LO,
  FAN_STRATEGIES,
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
import { ema } from './indicators.ts';
import algnUnstacked from './testdata/algn-unstacked-tag50.json' with { type: 'json' };

const onset: FanBacktestConfig = {
  ...DEFAULT_FAN_BACKTEST_CONFIG,
  strategy: 'onset',
  entry: 'match',
  macdWindow: false,
  maxHoldBars: 60,
  horizons: [5, 10],
  trailEma: null,
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
    const o = [10, 10.2];
    const l = [9.5, 9.0];
    const c = [10.1, 10.4];
    const ma = [9.8, 9.7];
    expect(isBunnLongReversal(o, l, c, ma, 1)).toBe(true);
  });

  it('rejects a Bunn reversal when the body is not fully above the EMA', () => {
    const o = [10, 9.5];
    const l = [9.4, 9.0];
    const c = [9.8, 10.2];
    const ma = [9.6, 9.7];
    expect(isBunnLongReversal(o, l, c, ma, 1)).toBe(false);
  });

  it('rejects a Bunn reversal whose tail does not undercut the prior low', () => {
    const o = [10, 10.2];
    const l = [9.0, 9.2];
    const c = [10.1, 10.4];
    const ma = [9.8, 9.7];
    expect(isBunnLongReversal(o, l, c, ma, 1)).toBe(false);
  });

  it('lists the 18-EMA bone-zone strategy', () => {
    expect(FAN_STRATEGIES.some((s) => s.id === 'tag18')).toBe(true);
  });

  it('lists the Bunn bounce strategy', () => {
    expect(FAN_STRATEGIES.some((s) => s.id === 'bunn_bounce')).toBe(true);
  });

  it('lists the Bunn continuation strategy', () => {
    expect(FAN_STRATEGIES.some((s) => s.id === 'bunn_cont')).toBe(true);
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

describe('findFanEntries onset', () => {
  it('finds match entries when the fan forms during history', () => {
    const closes = rampSeries(200, 90);
    const entries = findFanEntries({ ticker: 'RISE', name: 'Rise', closes }, onset);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].strategy).toBe('onset');
    expect(entries[0].forwardReturns[5]).toBeGreaterThan(0);
  });

  it('returns empty for too-short history', () => {
    expect(findFanEntries({ ticker: 'X', name: 'X', closes: [1, 2, 3] }, onset)).toEqual([]);
  });
});

describe('simulateRTrade', () => {
  const n = 10;
  const flat = Array(n).fill(100);
  const emas = { e18: flat, e50: Array(n).fill(95), e100: Array(n).fill(90), e200: Array(n).fill(80) };
  const macd = { line: Array(n).fill(1), signal: Array(n).fill(0), hist: Array(n).fill(1) };
  const cfg: FanBacktestConfig = { ...onset, macdWindow: false, maxHoldBars: null, targetR: 3 };
  const emas12 = (len: number) => ({
    e18: Array(len).fill(100), e50: Array(len).fill(95), e100: Array(len).fill(90), e200: Array(len).fill(80),
  });
  const macd12 = (len: number) => ({
    line: Array(len).fill(1), signal: Array(len).fill(0), hist: Array(len).fill(1),
  });

  it('stops at 1R when the low tags the stop (stop first if both hit)', () => {
    const bars = {
      o: flat, c: flat,
      h: [100, 100, 112, 100, 100, 100, 100, 100, 100, 100],
      l: [100, 100, 94, 100, 100, 100, 100, 100, 100, 100],
    };
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, cfg, false);
    expect(trade?.exitReason).toBe('stop_r');
    expect(trade?.realizedR).toBe(-1);
  });

  it('takes 3R when the high tags the target', () => {
    const bars = {
      o: flat, c: [...Array(3).fill(100), 116, ...Array(6).fill(116)],
      h: [...Array(3).fill(100), 116, ...Array(6).fill(116)],
      l: Array(n).fill(99),
    };
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, cfg, false);
    expect(trade?.exitReason).toBe('target_r');
    expect(trade?.realizedR).toBe(3);
  });

  it('exits at 2.5R when the target window is on', () => {
    const bars = {
      o: flat, c: [...Array(3).fill(100), 112.5, ...Array(6).fill(112.5)],
      h: [...Array(3).fill(100), 112.5, ...Array(6).fill(112.5)],
      l: Array(n).fill(99),
    };
    const trade = simulateRTrade(
      bars, emas, macd, 1, 95, 115,
      { ...cfg, trailEma: null, targetWindow: true },
      false,
    );
    expect(trade?.exitReason).toBe('target_window');
    expect(trade?.realizedR).toBe(BUNN_WINDOW_LO);
    expect(trade?.exitPrice).toBeCloseTo(112.5);
  });

  it('still prefers the stop when the window high and the stop hit the same bar', () => {
    const bars = {
      o: flat, c: flat,
      h: [100, 100, 112.5, 100, 100, 100, 100, 100, 100, 100],
      l: [100, 100, 94, 100, 100, 100, 100, 100, 100, 100],
    };
    const trade = simulateRTrade(
      bars, emas, macd, 1, 95, 115,
      { ...cfg, trailEma: null, targetWindow: true },
      false,
    );
    expect(trade?.exitReason).toBe('stop_r');
    expect(trade?.realizedR).toBe(-1);
  });

  it('moves the stop to breakeven after 1R and exits there on a pullback', () => {
    const bars = {
      o: flat, c: flat,
      h: [100, 100, 106, 104, 100, 100, 100, 100, 100, 100],
      l: [100, 100, 99, 99.5, 100, 100, 100, 100, 100, 100],
    };
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, { ...cfg, breakevenAtR: 1 }, false);
    expect(trade?.exitReason).toBe('breakeven');
    expect(trade?.realizedR).toBeCloseTo(0);
  });

  it('trails under the 50-EMA after breakeven', () => {
    const e50 = [95, 95, 96, 101, 102, 102, 102, 102, 102, 102];
    const trailEmas = { ...emas, e50 };
    const bars = {
      o: flat, c: flat,
      h: [100, 100, 106, 108, 108, 108, 108, 108, 108, 108],
      l: [100, 100, 99.5, 100.5, 100.8, 100, 100, 100, 100, 100],
    };
    const trade = simulateRTrade(
      bars, trailEmas, macd, 1, 95, 115,
      { ...cfg, breakevenAtR: 1, trailEma: 50, maxHoldBars: null },
      false,
    );
    expect(trade?.exitReason).toBe('trail');
    expect(trade?.realizedR).toBeGreaterThan(0);
  });

  it('exits on an 18-50 MACD flip when not trailing', () => {
    const bear = {
      line: [1, 1, -1, -1, -1, -1, -1, -1, -1, -1],
      signal: Array(n).fill(0),
      hist: [1, 1, -1, -1, -1, -1, -1, -1, -1, -1],
    };
    const bars = {
      o: flat, c: [...Array(2).fill(100), 101, ...Array(7).fill(101)],
      h: Array(n).fill(101),
      l: Array(n).fill(99),
    };
    const trade = simulateRTrade(bars, emas, bear, 1, 95, 115, { ...cfg, macdWindow: true, trailEma: null }, false);
    expect(trade?.exitReason).toBe('macd_window');
  });

  it('does not cut a trailed trade on a MACD flip', () => {
    const e50 = [95, 95, 96, 101, 102, 102, 102, 102, 102, 102];
    const bear = {
      line: [1, 1, 1, -1, -1, -1, -1, -1, -1, -1],
      signal: Array(n).fill(0),
      hist: [1, 1, 1, -1, -1, -1, -1, -1, -1, -1],
    };
    const bars = {
      o: flat, c: flat,
      h: [100, 100, 106, 108, 108, 108, 108, 108, 108, 108],
      l: [100, 100, 99.5, 100.5, 100.8, 100, 100, 100, 100, 100],
    };
    const trade = simulateRTrade(
      bars, { ...emas, e50 }, bear, 1, 95, 115,
      { ...cfg, macdWindow: true, breakevenAtR: 1, trailEma: 50, maxHoldBars: null },
      false,
    );
    expect(trade?.exitReason).toBe('trail');
    expect(trade?.exitReason).not.toBe('macd_window');
  });

  it('ratchets the stop 2¢ under a pivot confirmed after entry, then trails out', () => {
    const n = 12;
    const px = Array(n).fill(100);
    const bars = {
      o: px, c: px,
      h: [100, 100, 101, 100, 100.5, 102, 102, 102, 102, 100, 100, 100],
      l: [100, 100, 100, 98, 100, 99, 99, 97.9, 97.9, 97.9, 97.9, 97.9],
    };
    const trade = simulateRTrade(
      bars, emas12(n), macd12(n), 1, 95, 115,
      { ...cfg, trailEma: null, trailPivot: true, breakevenAtR: null, maxHoldBars: null },
      false,
    );
    expect(trade?.exitReason).toBe('pivot_trail');
    expect(trade?.exitPrice).toBeCloseTo(98 - BUNN_PENNY, 8);
    expect(trade?.realizedR).toBeGreaterThan(-1);
  });

  it('does not raise the stop for a pivot confirmed before entry', () => {
    const n = 12;
    const px = Array(n).fill(100);
    const bars = {
      o: px, c: px,
      h: [101, 101, 101, 101, 101.1, 100, 100, 100, 100, 100, 100, 100],
      l: [100, 100, 98, 100, 100, 100, 95.9, 94.9, 94.9, 94.9, 94.9, 94.9],
    };
    const trade = simulateRTrade(
      bars, emas12(n), macd12(n), 5, 95, 115,
      { ...cfg, trailEma: null, trailPivot: true, breakevenAtR: null, maxHoldBars: null },
      false,
    );
    expect(trade?.exitReason).toBe('stop_r');
    expect(trade?.exitPrice).toBe(95);
    expect(trade?.realizedR).toBe(-1);
  });

  it('does not cut a pivot-trailed trade on a MACD flip', () => {
    const n = 12;
    const px = Array(n).fill(100);
    const bear = {
      line: Array(n).fill(-1),
      signal: Array(n).fill(0),
      hist: Array(n).fill(-1),
    };
    const bars = {
      o: px, c: px,
      h: [100, 100, 101, 100, 100.5, 102, 102, 102, 102, 100, 100, 100],
      l: [100, 100, 100, 98, 100, 99, 99, 97.9, 97.9, 97.9, 97.9, 97.9],
    };
    const trade = simulateRTrade(
      bars, emas12(n), bear, 1, 95, 115,
      { ...cfg, trailEma: null, trailPivot: true, macdWindow: true, breakevenAtR: null, maxHoldBars: null },
      false,
    );
    expect(trade?.exitReason).toBe('pivot_trail');
    expect(trade?.exitReason).not.toBe('macd_window');
  });

  it('does not cut a pivot trail on max hold while the slow fan holds', () => {
    const n = 12;
    const px = Array(n).fill(100);
    const bars = {
      o: px, c: px,
      h: [100, 100, 101, 100, 100.5, 102, 102, 102, 102, 100, 100, 100],
      l: [100, 100, 100, 98, 100, 99, 99, 97.9, 97.9, 97.9, 97.9, 97.9],
    };
    const trade = simulateRTrade(
      bars, emas12(n), macd12(n), 1, 95, 115,
      { ...cfg, trailEma: null, trailPivot: true, breakevenAtR: null, maxHoldBars: 2 },
      false,
    );
    expect(trade?.exitReason).toBe('pivot_trail');
    expect(trade?.exitReason).not.toBe('max_hold');
  });
});

describe('DEFAULT_FAN_BACKTEST_CONFIG', () => {
  it('defaults to a 50-EMA tag, trail 50, MACD off', () => {
    expect(DEFAULT_FAN_BACKTEST_CONFIG.strategy).toBe('tag50');
    expect(DEFAULT_FAN_BACKTEST_CONFIG.trailEma).toBe(50);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.targetWindow).toBe(false);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.trailPivot).toBeFalsy();
    expect(DEFAULT_FAN_BACKTEST_CONFIG.macdWindow).toBe(false);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.breakevenAtR).toBe(1);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.stopAtrMult).toBe(0.25);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.ema200RisingBars).toBe(21);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.startCash).toBe(10_000);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.riskPct).toBe(1);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.maxPositions).toBe(4);
    expect(DEFAULT_FAN_BACKTEST_CONFIG.windowMonths).toBe(3);
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
});

function sampleEvent(over: Partial<FanEntryEvent> = {}, reason: FanTradeExitReason = 'trail'): FanEntryEvent {
  return {
    ticker: 'XLNX',
    name: 'Xilinx',
    date: '2017-09-07',
    barIndex: 40,
    strategy: 'tag50',
    signal: 'match',
    entryPrice: 64.32,
    worstGap: 0.01,
    forwardReturns: {},
    trade: {
      entryBar: 40, exitBar: 48, entryPrice: 64.32, exitPrice: 69.17,
      stopPrice: 62.8, targetPrice: 68.88, returnPct: 7.54, realizedR: 4.38,
      barsHeld: 8, maxFavorablePct: 8.1, maxAdversePct: -0.9, exitReason: reason,
    },
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
    expect(s.entry).toMatch(/8 bar/);
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

  it('describes a Bunn bounce as a buy-stop fill', () => {
    const s = explainFanTrade(sampleEvent({ strategy: 'bunn_bounce', fanBar: 39, reactionBar: 39, impulseBar: 38 }));
    expect(s.entry).toMatch(/buy stop/i);
    expect(s.entry).toMatch(/50, 100, or 200/);
    expect(s.entry).not.toMatch(/Fan first stacked/);
  });

  it('describes a Bunn continuation as a buy-stop fill after the fan resumes', () => {
    const s = explainFanTrade(sampleEvent({ strategy: 'bunn_cont', fanBar: 30, reactionBar: 34, impulseBar: 38, barIndex: 40 }));
    expect(s.entry).toMatch(/buy stop/i);
    expect(s.entry).toMatch(/adversely crossed/);
    expect(s.entry).not.toMatch(/Fan first stacked/);
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

describe('findFanEntries requires the uptrend fan at tag50', () => {
  it('does not take ALGN 2016-02-24, where EMA18 was under EMA50', () => {
    const cfg: FanBacktestConfig = { ...DEFAULT_FAN_BACKTEST_CONFIG, strategy: 'tag50' };
    const entries = findFanEntries({
      ticker: algnUnstacked.ticker,
      name: algnUnstacked.name,
      closes: algnUnstacked.closes,
      opens: algnUnstacked.opens,
      highs: algnUnstacked.highs,
      lows: algnUnstacked.lows,
      dates: algnUnstacked.dates,
    }, cfg);
    expect(entries.some((e) => e.date === '2016-02-24')).toBe(false);
    const e18 = ema(algnUnstacked.closes, 18);
    const e50 = ema(algnUnstacked.closes, 50);
    const e100 = ema(algnUnstacked.closes, 100);
    const e200 = ema(algnUnstacked.closes, 200);
    for (const e of entries) {
      expect(fullFanUp(e18, e50, e100, e200, e.barIndex)).toBe(true);
    }
  });
});

function stackedOhlc() {
  const c = rampSeries(200, 90);
  const o = c.map((x, i) => (i === 0 ? x : (c[i - 1] + x) / 2));
  const h = c.map((x, i) => Math.max(x, o[i]) + 0.25);
  const l = c.map((x, i) => Math.min(x, o[i]) - 0.25);
  return { ticker: 'BNC', name: 'Bounce', closes: c, opens: o, highs: h, lows: l };
}

const bounceCfg: FanBacktestConfig = { ...DEFAULT_FAN_BACKTEST_CONFIG, strategy: 'bunn_bounce' };

describe('findFanEntries bunn_bounce', () => {
  it('fills a buy stop 2¢ above the reversal, not the trigger close, with R = bar height + 2¢', () => {
    const s = stackedOhlc();
    const trigger = s.closes.length - 6;
    const e50 = ema(s.closes, 50);
    s.opens[trigger] = Math.max(s.opens[trigger], e50[trigger] + 0.2);
    s.lows[trigger] = Math.min(e50[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    s.highs[trigger + 1] = Math.max(s.highs[trigger + 1], s.highs[trigger] + BUNN_PENNY + 0.05);

    const entries = findFanEntries(s, bounceCfg);
    expect(entries.length).toBeGreaterThan(0);
    const ev = entries.find((e) => e.reactionBar === trigger) ?? entries[0];
    expect(ev.reactionBar).toBe(trigger);
    expect(ev.barIndex).toBeGreaterThan(ev.reactionBar);
    expect(ev.entryPrice).toBeCloseTo(s.highs[trigger] + BUNN_PENNY, 8);
    expect(ev.entryPrice).not.toBeCloseTo(s.closes[trigger], 2);
    const height = s.highs[trigger] - s.lows[trigger];
    expect(ev.trade).not.toBeNull();
    expect(ev.entryPrice - ev.trade!.stopPrice).toBeCloseTo(height + BUNN_PENNY, 8);
  });

  it('fires on a 100-EMA reversal that is not a 50-EMA reversal', () => {
    const s = stackedOhlc();
    const trigger = s.closes.length - 6;
    const e50 = ema(s.closes, 50);
    const e100 = ema(s.closes, 100);
    // Close stays on the ramp (EMAs unchanged). Open sits between 100 and 50 so
    // the body is not fully above the 50, but is fully above the 100.
    s.opens[trigger] = e100[trigger] + (e50[trigger] - e100[trigger]) * 0.3;
    s.lows[trigger] = Math.min(e100[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    s.highs[trigger + 1] = Math.max(s.highs[trigger + 1], s.highs[trigger] + BUNN_PENNY + 0.05);

    expect(isBunnLongReversal(s.opens, s.lows, s.closes, e100, trigger)).toBe(true);
    expect(isBunnLongReversal(s.opens, s.lows, s.closes, e50, trigger)).toBe(false);

    const entries = findFanEntries(s, bounceCfg);
    expect(entries.some((e) => e.reactionBar === trigger)).toBe(true);
  });

  it('does not fill when later highs never take out the buy stop', () => {
    const s = stackedOhlc();
    const trigger = s.closes.length - 6;
    const e50 = ema(s.closes, 50);
    s.opens[trigger] = Math.max(s.opens[trigger], e50[trigger] + 0.2);
    s.lows[trigger] = Math.min(e50[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    for (let j = trigger + 1; j < s.highs.length; j++) {
      s.highs[j] = Math.min(s.highs[j], s.highs[trigger]);
    }
    expect(findFanEntries(s, bounceCfg)).toEqual([]);
  });
});

function continuationOhlc() {
  const up = rampSeries(220, 80);
  const peak = up[up.length - 1];
  const down = Array.from({ length: 28 }, (_, i) => peak - (i + 1) * 0.65);
  const trough = down[down.length - 1];
  const recover = Array.from({ length: 24 }, (_, i) => trough + (i + 1) * 0.75);
  const c = [...up, ...down, ...recover];
  const o = c.map((x, i) => (i === 0 ? x : (c[i - 1] + x) / 2));
  const h = c.map((x, i) => Math.max(x, o[i]) + 0.25);
  const l = c.map((x, i) => Math.min(x, o[i]) - 0.25);
  return { ticker: 'CNT', name: 'Cont', closes: c, opens: o, highs: h, lows: l };
}

function adverseResumeOf(s: ReturnType<typeof continuationOhlc>) {
  const e18 = ema(s.closes, 18);
  const e50 = ema(s.closes, 50);
  const e100 = ema(s.closes, 100);
  const e200 = ema(s.closes, 200);
  let adverse = -1;
  let resume = -1;
  for (let i = 200; i < s.closes.length - 3; i++) {
    if (adverse < 0 && crossDown18_50(e18, e50, i) && slowFanUp(e50, e100, e200, i)) adverse = i;
    else if (adverse >= 0 && resume < 0 && crossUp18_50(e18, e50, i) && fullFanUp(e18, e50, e100, e200, i)) {
      resume = i;
      break;
    }
  }
  return { adverse, resume, e18, e50, e100, e200 };
}

const contCfg: FanBacktestConfig = { ...DEFAULT_FAN_BACKTEST_CONFIG, strategy: 'bunn_cont' };

describe('findFanEntries bunn_cont', () => {
  it('fills a buy stop 2¢ above the resume bar, with R from the 100/200 bounce low', () => {
    const s = continuationOhlc();
    const { adverse, resume, e100 } = adverseResumeOf(s);
    expect(adverse).toBeGreaterThan(0);
    expect(resume).toBeGreaterThan(adverse + 1);
    let bounce = -1;
    for (let i = adverse; i < resume; i++) {
      if (s.closes[i] > e100[i]) {
        bounce = i;
        break;
      }
    }
    if (bounce < 0) {
      bounce = adverse + 1;
      s.closes[bounce] = e100[bounce] + 0.35;
    }
    s.opens[bounce] = Math.max(s.opens[bounce], e100[bounce] + 0.15);
    s.lows[bounce] = Math.min(e100[bounce], s.lows[bounce - 1] ?? s.closes[bounce - 1]) - 0.25;
    s.highs[bounce] = Math.max(s.highs[bounce], s.closes[bounce], s.opens[bounce]) + 0.15;
    s.highs[resume + 1] = Math.max(s.highs[resume + 1], s.highs[resume] + BUNN_PENNY + 0.05);

    const e100b = ema(s.closes, 100);
    expect(isBunnLongReversal(s.opens, s.lows, s.closes, e100b, bounce)).toBe(true);

    const entries = findFanEntries(s, contCfg);
    const ev = entries.find((e) => e.impulseBar === resume) ?? entries[0];
    expect(ev).toBeTruthy();
    expect(ev.fanBar).toBe(adverse);
    expect(ev.reactionBar).toBe(bounce);
    expect(ev.impulseBar).toBe(resume);
    expect(ev.barIndex).toBeGreaterThan(resume);
    expect(ev.entryPrice).toBeCloseTo(s.highs[resume] + BUNN_PENNY, 8);
    expect(ev.entryPrice).not.toBeCloseTo(s.closes[resume], 2);
    expect(ev.trade).not.toBeNull();
    expect(ev.entryPrice - ev.trade!.stopPrice).toBeCloseTo(ev.entryPrice - (s.lows[bounce] - BUNN_PENNY), 8);
  });

  it('does not enter when the correction has no 100/200 reversal', () => {
    const s = continuationOhlc();
    const { adverse, resume, e100, e200 } = adverseResumeOf(s);
    expect(adverse).toBeGreaterThan(0);
    expect(resume).toBeGreaterThan(adverse);
    for (let i = adverse; i < resume; i++) {
      const floor = Math.max(e100[i], e200[i]) + 0.08;
      if (s.lows[i] < floor) s.lows[i] = floor;
    }
    expect(findFanEntries(s, contCfg)).toEqual([]);
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

  it('expands left to include a fan bar outside the default pad', () => {
    expect(tradeChartRange(100, 110, 200, 10, 5, [50])).toEqual({ from: 42, to: 115 });
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

describe('setup bars on entries', () => {
  it('records fan/reaction/impulse on onset as the same bar', () => {
    const entries = findFanEntries({ ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) }, onset);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].fanBar).toBe(entries[0].barIndex);
    expect(entries[0].reactionBar).toBe(entries[0].barIndex);
    expect(entries[0].impulseBar).toBe(entries[0].barIndex);
  });

  it('mentions how many bars earlier the fan stacked', () => {
    const s = explainFanTrade(sampleEvent());
    expect(s.entry).toMatch(/8 bars earlier/);
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

describe('200-EMA rising lookback', () => {
  it('skips fills when history is shorter than the lookback', () => {
    const subject = { ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) };
    expect(findFanEntries(subject, { ...onset, ema200RisingBars: 0 }).length).toBeGreaterThan(0);
    expect(findFanEntries(subject, { ...onset, ema200RisingBars: 250 })).toEqual([]);
  });

  it('still takes a long ramp when the 200-EMA has been rising for a month', () => {
    const entries = findFanEntries(
      { ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) },
      { ...onset, ema200RisingBars: 21 },
    );
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('classic MACD / Stoch RSI at entry', () => {
  it('snapshots finite MACD and Stoch RSI on a ramping onset fill', () => {
    const entries = findFanEntries({ ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) }, onset);
    expect(entries.length).toBeGreaterThan(0);
    const ind = entries[0].indicators;
    expect(ind).not.toBeNull();
    expect(Number.isFinite(ind!.macdHist)).toBe(true);
    expect(ind!.stochK).toBeGreaterThanOrEqual(0);
    expect(ind!.stochK).toBeLessThanOrEqual(100);
  });

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

describe('findFanEntries exit dates + account overlay', () => {
  it('stamps exitDate from the subject calendar', () => {
    const closes = rampSeries(200, 90);
    const dates = datesEnding(closes.length);
    const entries = findFanEntries({ ticker: 'RISE', name: 'Rise', closes, dates }, onset);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].trade?.exitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

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
