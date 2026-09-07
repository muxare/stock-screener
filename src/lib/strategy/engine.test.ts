import { describe, it, expect } from 'vitest';
import { ema } from '../indicators.ts';
import { DEFAULT_FAN_BACKTEST_CONFIG, type FanBacktestConfig, type FanBacktestSubject } from '../fanBacktest.ts';
import { findStrategyEntries, runStrategy } from './engine.ts';
import { presetById, presets, DEFAULT_EXIT } from './presets.ts';
import { BUNN_PENNY, crossDown18_50, crossUp18_50, fullFanUp, isBunnLongReversal, slowFanUp } from './primitives.ts';
import type { ExitSpec, Step, StrategyDef } from './types.ts';
import algnUnstacked from '../testdata/algn-unstacked-tag50.json' with { type: 'json' };

function rampSeries(flatBars: number, rampBars: number, flat = 10, step = 0.45): number[] {
  return [
    ...Array(flatBars).fill(flat),
    ...Array.from({ length: rampBars }, (_, i) => flat + (i + 1) * step),
  ];
}

const cfg = (strategy: StrategyDef, over: Partial<FanBacktestConfig> = {}): FanBacktestConfig => ({
  ...DEFAULT_FAN_BACKTEST_CONFIG,
  strategy,
  horizons: [5, 10],
  ...over,
});

const HARD_EXIT: ExitSpec = { ...DEFAULT_EXIT, trailEma: null, breakevenAtR: null, maxHoldBars: 60 };

const onset = cfg({ ...presetById('onset'), trade: { ...presetById('onset').trade, exit: { ...HARD_EXIT, fanExit: 'full' } } });

function custom(steps: Step[], over: Partial<StrategyDef['trade']> = {}): StrategyDef {
  return {
    id: 'custom',
    name: 'Custom',
    steps,
    trade: {
      entry: { mode: 'close', offset: 0, maxWait: null },
      stop: { anchor: 'setup_low', underEma50: false, atrPad: 0.25, offset: 0 },
      exit: { ...HARD_EXIT },
      ...over,
    },
  };
}

interface Ohlc { ticker: string; name: string; closes: number[]; opens: number[]; highs: number[]; lows: number[] }

function stackedOhlc(rampBars = 90, jump = 0): Ohlc {
  const c = rampSeries(200, rampBars).map((x, i) => (i >= 200 ? x + jump : x));
  const o = c.map((x, i) => (i === 0 ? x : (c[i - 1] + x) / 2));
  const h = c.map((x, i) => Math.max(x, o[i]) + 0.25);
  const l = c.map((x, i) => Math.min(x, o[i]) - 0.25);
  return { ticker: 'BNC', name: 'Bounce', closes: c, opens: o, highs: h, lows: l };
}

/**
 * Append a bar shaped relative to the running 18-EMA (before this bar). The
 * body is placed just above the given low unless `o` / `c` are set; high and
 * low are widened to contain the body so every bar is a valid candle.
 */
function push(s: Ohlc, bar: (e18: number, last: { h: number; l: number; c: number }) => { o?: number; h: number; l: number; c?: number }): number {
  const e18 = ema(s.closes, 18);
  const n = s.closes.length;
  const b = bar(e18[n - 1], { h: s.highs[n - 1], l: s.lows[n - 1], c: s.closes[n - 1] });
  const c = b.c ?? b.l + 0.4;
  const o = b.o ?? c - 0.1;
  s.closes.push(c);
  s.opens.push(o);
  s.highs.push(Math.max(b.h, c, o));
  s.lows.push(Math.min(b.l, c, o));
  return n;
}

/** Two quiet bars (higher lows, lower highs, clear of the 18) so the last engineered bar is never the final one. */
function pad(s: Ohlc, n = 2) {
  for (let k = 0; k < n; k++) push(s, (e18, last) => ({ h: last.h - 0.01, l: Math.max(e18 + 0.5, last.l + 0.01) }));
}

describe('onset preset', () => {
  it('finds match entries when the fan forms during history, with one mark per step', () => {
    const closes = rampSeries(200, 90);
    const entries = findStrategyEntries({ ticker: 'RISE', name: 'Rise', closes }, onset);
    expect(entries.length).toBeGreaterThan(0);
    const e = entries[0];
    expect(e.strategyId).toBe('onset');
    expect(e.entryMode).toBe('close');
    expect(e.forwardReturns[5]).toBeGreaterThan(0);
    expect(e.marks).toHaveLength(1);
    expect(e.marks[0]).toMatchObject({ stepId: 'onset', stepIndex: 0, kind: 'candle', bar: e.barIndex });
    expect(e.fanBar).toBe(e.barIndex);
    expect(e.reactionBar).toBe(e.barIndex);
    expect(e.impulseBar).toBe(e.barIndex);
  });

  it('returns empty for too-short history', () => {
    expect(findStrategyEntries({ ticker: 'X', name: 'X', closes: [1, 2, 3] }, onset)).toEqual([]);
  });

  it('resets after an entry for a strategy without a tracker', () => {
    const run = runStrategy({ ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) }, onset, { trace: true });
    expect(run.entries.length).toBeGreaterThan(0);
    expect(run.trace.some((t) => t.reason === 'taken' && t.bar === run.entries[0].barIndex)).toBe(true);
  });
});

describe('200-EMA rising lookback', () => {
  it('skips fills when history is shorter than the lookback', () => {
    const subject = { ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) };
    expect(findStrategyEntries(subject, { ...onset, ema200RisingBars: 0 }).length).toBeGreaterThan(0);
    expect(findStrategyEntries(subject, { ...onset, ema200RisingBars: 250 })).toEqual([]);
  });

  it('still takes a long ramp when the 200-EMA has been rising for a month', () => {
    expect(findStrategyEntries({ ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) }, { ...onset, ema200RisingBars: 21 }).length).toBeGreaterThan(0);
  });
});

describe('classic MACD / Stoch RSI at entry', () => {
  it('snapshots finite MACD and Stoch RSI on a ramping onset fill', () => {
    const entries = findStrategyEntries({ ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) }, onset);
    const ind = entries[0].indicators;
    expect(ind).not.toBeNull();
    expect(Number.isFinite(ind!.macdHist)).toBe(true);
    expect(ind!.stochK).toBeGreaterThanOrEqual(0);
    expect(ind!.stochK).toBeLessThanOrEqual(100);
  });
});

function datesEnding(n: number, endIso = '2026-06-19'): string[] {
  const [y, m, d] = endIso.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

describe('exit dates', () => {
  it('stamps exitDate from the subject calendar', () => {
    const closes = rampSeries(200, 90);
    const entries = findStrategyEntries({ ticker: 'RISE', name: 'Rise', closes, dates: datesEnding(closes.length) }, onset);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].trade?.exitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

const algn: FanBacktestSubject = {
  ticker: algnUnstacked.ticker,
  name: algnUnstacked.name,
  closes: algnUnstacked.closes,
  opens: algnUnstacked.opens,
  highs: algnUnstacked.highs,
  lows: algnUnstacked.lows,
  dates: algnUnstacked.dates,
};

describe('tag50 preset requires the uptrend fan (ALGN regression)', () => {
  it('does not take ALGN 2016-02-24, where EMA18 was under EMA50', () => {
    const entries = findStrategyEntries(algn, cfg(presetById('tag50')));
    expect(entries.some((e) => e.date === '2016-02-24')).toBe(false);
    const e18 = ema(algn.closes, 18);
    const e50 = ema(algn.closes, 50);
    const e100 = ema(algn.closes, 100);
    const e200 = ema(algn.closes, 200);
    for (const e of entries) expect(fullFanUp(e18, e50, e100, e200, e.barIndex)).toBe(true);
  });
});

describe('every preset marks one step per fired step', () => {
  const subjects: FanBacktestSubject[] = [algn, stackedOhlc(), { ticker: 'RISE', name: 'Rise', closes: rampSeries(200, 90) }];
  for (const p of presets()) {
    it(`${p.id}: marks.length === steps.length and stepIndex === i`, () => {
      for (const s of subjects) {
        for (const e of findStrategyEntries(s, cfg(p))) {
          expect(e.marks).toHaveLength(p.steps.length);
          e.marks.forEach((m, i) => {
            expect(m.stepIndex).toBe(i);
            expect(m.stepId).toBe(p.steps[i].id);
          });
          expect(e.entryMode).toBe(p.trade.entry.mode);
          expect(e.strategyName).toBe(p.name);
        }
      }
    });
  }

  it('never tags on the cross bar (tag presets)', () => {
    for (const id of ['tag18', 'tag50', 'structure', 'dual_ema']) {
      for (const e of findStrategyEntries(algn, cfg(presetById(id)))) {
        expect(e.marks[3].bar).toBeGreaterThan(e.marks[0].bar);
        expect(e.fanBar).toBe(e.marks[0].bar);
        expect(e.reactionBar).toBe(e.barIndex);
      }
    }
  });
});

const bounceCfg = cfg(presetById('bunn_bounce'));

describe('bunn_bounce preset', () => {
  it('fills a buy stop 2¢ above the reversal, not the trigger close, with R = bar height + 2¢', () => {
    const s = stackedOhlc();
    const trigger = s.closes.length - 6;
    const e50 = ema(s.closes, 50);
    s.opens[trigger] = Math.max(s.opens[trigger], e50[trigger] + 0.2);
    s.lows[trigger] = Math.min(e50[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    s.highs[trigger + 1] = Math.max(s.highs[trigger + 1], s.highs[trigger] + BUNN_PENNY + 0.05);

    const entries = findStrategyEntries(s, bounceCfg);
    expect(entries.length).toBeGreaterThan(0);
    const ev = entries.find((e) => e.reactionBar === trigger) ?? entries[0];
    expect(ev.reactionBar).toBe(trigger);
    expect(ev.marks[1]).toMatchObject({ stepId: 'reversal', bar: trigger });
    expect(ev.barIndex).toBeGreaterThan(ev.reactionBar);
    expect(ev.entryMode).toBe('buy_stop');
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
    s.opens[trigger] = e100[trigger] + (e50[trigger] - e100[trigger]) * 0.3;
    s.lows[trigger] = Math.min(e100[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    s.highs[trigger + 1] = Math.max(s.highs[trigger + 1], s.highs[trigger] + BUNN_PENNY + 0.05);
    expect(isBunnLongReversal(s.opens, s.lows, s.closes, e100, trigger)).toBe(true);
    expect(isBunnLongReversal(s.opens, s.lows, s.closes, e50, trigger)).toBe(false);
    expect(findStrategyEntries(s, bounceCfg).some((e) => e.reactionBar === trigger)).toBe(true);
  });

  it('does not fill when later highs never take out the buy stop', () => {
    const s = stackedOhlc();
    const trigger = s.closes.length - 6;
    const e50 = ema(s.closes, 50);
    s.opens[trigger] = Math.max(s.opens[trigger], e50[trigger] + 0.2);
    s.lows[trigger] = Math.min(e50[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    for (let j = trigger + 1; j < s.highs.length; j++) s.highs[j] = Math.min(s.highs[j], s.highs[trigger]);
    expect(findStrategyEntries(s, bounceCfg)).toEqual([]);
  });

  it('expires a pending buy stop after entry.maxWait bars', () => {
    const s = stackedOhlc();
    const trigger = s.closes.length - 6;
    const e50 = ema(s.closes, 50);
    s.opens[trigger] = Math.max(s.opens[trigger], e50[trigger] + 0.2);
    s.lows[trigger] = Math.min(e50[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    s.highs[trigger + 1] = Math.min(s.highs[trigger + 1], s.highs[trigger]);
    s.highs[trigger + 2] = Math.max(s.highs[trigger + 2], s.highs[trigger] + BUNN_PENNY + 0.05);
    const def = presetById('bunn_bounce');
    const patient = findStrategyEntries(s, cfg({ ...def, trade: { ...def.trade, entry: { ...def.trade.entry, maxWait: 2 } } }));
    expect(patient.some((e) => e.reactionBar === trigger && e.barIndex === trigger + 2)).toBe(true);
    const hasty = runStrategy(s, cfg({ ...def, trade: { ...def.trade, entry: { ...def.trade.entry, maxWait: 1 } } }), { trace: true });
    expect(hasty.entries.some((e) => e.reactionBar === trigger)).toBe(false);
    expect(hasty.trace.some((t) => t.reason === 'pending_expired' && t.bar === trigger + 1)).toBe(true);
  });
});

describe('pending buy stop dies on a hold break', () => {
  it('drops the fill when a held step breaks before the buy stop is hit', () => {
    const s = stackedOhlc();
    const trigger = s.closes.length - 6;
    const e18 = ema(s.closes, 18);
    const e50 = ema(s.closes, 50);
    s.opens[trigger] = Math.max(s.opens[trigger], e50[trigger] + 0.2);
    s.lows[trigger] = Math.min(e50[trigger], s.lows[trigger - 1]) - 0.25;
    s.highs[trigger] = Math.max(s.highs[trigger], s.closes[trigger], s.opens[trigger]) + 0.15;
    // Next bar: the close collapses under the 18 (hold breaks) even though the high would fill.
    s.closes[trigger + 1] = e18[trigger] - 3;
    s.opens[trigger + 1] = s.closes[trigger + 1] + 0.1;
    s.highs[trigger + 1] = s.highs[trigger] + BUNN_PENNY + 0.5;
    s.lows[trigger + 1] = s.closes[trigger + 1] - 0.1;
    const steps: Step[] = [
      { id: 'above18', type: 'price_vs_ema', ema: 18, field: 'close', dir: 'above', hold: true },
      { id: 'reversal', type: 'reversal_candle', emas: [50], style: 'bunn', refresh: false },
    ];
    const def = custom(steps, {
      entry: { mode: 'buy_stop', offset: BUNN_PENNY, maxWait: null },
      stop: { anchor: 'trigger_low', underEma50: false, atrPad: 0, offset: 0 },
    });
    const run = runStrategy(s, cfg(def), { trace: true });
    expect(run.entries.some((e) => e.reactionBar === trigger)).toBe(false);
    expect(run.trace.some((t) => t.reason === 'hold' && t.stepId === 'above18' && t.bar === trigger + 1)).toBe(true);
  });
});

function continuationOhlc(): Ohlc {
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

function adverseResumeOf(s: Ohlc) {
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

const contCfg = cfg(presetById('bunn_cont'));

describe('bunn_cont preset', () => {
  it('fills a buy stop 2¢ above the resume bar, with R from the 100/200 bounce low', () => {
    const s = continuationOhlc();
    const { adverse, resume, e100 } = adverseResumeOf(s);
    expect(adverse).toBeGreaterThan(0);
    expect(resume).toBeGreaterThan(adverse + 1);
    let bounce = -1;
    for (let i = adverse + 1; i < resume; i++) {
      if (s.closes[i] > e100[i]) { bounce = i; break; }
    }
    if (bounce < 0) {
      bounce = adverse + 1;
      s.closes[bounce] = e100[bounce] + 0.35;
    }
    s.opens[bounce] = Math.max(s.opens[bounce], e100[bounce] + 0.15);
    s.lows[bounce] = Math.min(e100[bounce], s.lows[bounce - 1] ?? s.closes[bounce - 1]) - 0.25;
    s.highs[bounce] = Math.max(s.highs[bounce], s.closes[bounce], s.opens[bounce]) + 0.15;
    s.highs[resume + 1] = Math.max(s.highs[resume + 1], s.highs[resume] + BUNN_PENNY + 0.05);
    expect(isBunnLongReversal(s.opens, s.lows, s.closes, ema(s.closes, 100), bounce)).toBe(true);

    const entries = findStrategyEntries(s, contCfg);
    const ev = entries.find((e) => e.marks[3]?.bar === resume) ?? entries[0];
    expect(ev).toBeTruthy();
    expect(ev.marks.map((m) => m.stepId)).toEqual(['adverse', 'fan', 'reversal', 'resume']);
    expect(ev.marks[0].bar).toBe(adverse);
    expect(ev.marks[2].bar).toBe(bounce);
    expect(ev.marks[3].bar).toBe(resume);
    expect(ev.fanBar).toBe(adverse);
    expect(ev.reactionBar).toBe(resume);
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
    expect(findStrategyEntries(s, contCfg)).toEqual([]);
  });
});

describe('hold reset', () => {
  it('records a hold reset with the step id when the full fan breaks', () => {
    const s = continuationOhlc();
    const def = custom([
      { id: 'fan', type: 'fan_up', mode: 'full', hold: true },
      { id: 'tag', type: 'ema_tag', ema: 50, throughEma: null, confirm: 'none' },
    ]);
    const run = runStrategy(s, cfg(def), { trace: true });
    const { adverse } = adverseResumeOf(s);
    const hold = run.trace.find((t) => t.reason === 'hold' && t.stepId === 'fan');
    expect(hold).toBeTruthy();
    expect(hold!.bar).toBeLessThanOrEqual(adverse);
  });
});

/** Ramp to a peak P, then a pullback of `lowerLowBars` lower lows and a tag of the 18 on the bar after. */
function swingFixture(lowerLowBars: number): { s: Ohlc; peak: number; tagBar: number } {
  const s = stackedOhlc(60, 2);
  const peak = s.closes.length - 1;
  for (let k = 1; k <= lowerLowBars; k++) {
    push(s, (e18, last) => ({ h: last.h - 0.4, l: e18 + 3 - k }));
  }
  const tagBar = push(s, (e18, last) => ({ h: last.h - 0.4, l: e18 - 0.05, c: e18 + 0.3, o: e18 + 0.2 }));
  pad(s);
  return { s, peak, tagBar };
}

const swingSteps = (maxLowerLows: number, rearm = true): Step[] => [
  { id: 'fan', type: 'fan_up', mode: 'full', hold: true },
  { id: 'swing', type: 'pullback', mode: 'swing', maxLowerLows, rearmOnNewHigh: rearm },
  { id: 'tag', type: 'ema_tag', ema: 18, throughEma: null, confirm: 'none' },
];

describe('swing pullback tracker', () => {
  it('enters on the tag with the swing high as the impulse mark', () => {
    const { s, peak, tagBar } = swingFixture(2);
    const entries = findStrategyEntries(s, cfg(custom(swingSteps(3))));
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.barIndex).toBe(tagBar);
    expect(e.marks.map((m) => m.stepId)).toEqual(['fan', 'swing', 'tag']);
    expect(e.marks[1]).toMatchObject({ kind: 'tracker', bar: peak, price: s.highs[peak] });
    expect(e.impulseBar).toBe(peak);
    expect(e.fanBar).toBe(peak);
    expect(e.reactionBar).toBe(tagBar);
    expect(e.trade!.stopPrice).toBeLessThan(s.lows[tagBar]);
  });

  it('resets after too many lower lows (three with a max of two)', () => {
    const { s, tagBar } = swingFixture(2);
    const run = runStrategy(s, cfg(custom(swingSteps(2))), { trace: true });
    expect(run.entries).toEqual([]);
    expect(run.trace.some((t) => t.reason === 'lower_lows' && t.stepId === 'swing' && t.bar === tagBar)).toBe(true);
  });

  it('re-arms after a new swing high (2 entries vs 1)', () => {
    const build = () => {
      const { s } = swingFixture(1);
      // New swing high, one lower low, then another tag.
      push(s, (e18) => ({ h: Math.max(...s.highs) + 1, l: e18 + 0.2 }));
      push(s, (e18, last) => ({ h: last.h - 3, l: e18 + 0.05 }));
      push(s, (e18, last) => ({ h: last.h - 0.4, l: e18 - 0.05, c: e18 + 0.3, o: e18 + 0.2 }));
      pad(s);
      return s;
    };
    const quick = (rearm: boolean) => custom(swingSteps(3, rearm), { exit: { ...HARD_EXIT, maxHoldBars: 1 } });
    const on = findStrategyEntries(build(), cfg(quick(true)));
    const off = findStrategyEntries(build(), cfg(quick(false)));
    expect(on).toHaveLength(2);
    expect(off).toHaveLength(1);
    expect(on[1].impulseBar).toBeGreaterThan(on[0].impulseBar);
  });

  it('a failing guard cancels back to the tag but keeps the swing mark', () => {
    const { s } = swingFixture(1);
    // Tag the 50 twice. Bar 1 closes far under the 18, so the 18 falls and the
    // slope guard fails; bar 2 closes above the prior 18, so the guard passes.
    const e50 = () => ema(s.closes, 50)[s.closes.length - 1];
    push(s, (_e18, last) => ({ h: last.h - 0.4, l: e50() - 0.05, c: e50() + 0.3, o: e50() + 0.2 }));
    const second = push(s, (e18, last) => ({ h: last.h - 0.4, l: e50() - 0.05, c: e18 + 0.5, o: e18 + 0.4 }));
    pad(s);
    const steps: Step[] = [
      ...swingSteps(4).map((st) => (st.type === 'ema_tag' ? { ...st, ema: 50 as const } : st)),
      { id: 'slope', type: 'ema_slope', ema: 18, lookback: 1 },
    ];
    const run = runStrategy(s, cfg(custom(steps)), { trace: true });
    expect(run.trace.some((t) => t.reason === 'guard' && t.stepId === 'slope')).toBe(true);
    expect(run.entries).toHaveLength(1);
    const e = run.entries[0];
    expect(e.barIndex).toBe(second);
    expect(e.marks.map((m) => m.stepId)).toEqual(['fan', 'swing', 'tag', 'slope']);
    expect(e.marks[1].kind).toBe('tracker');
    expect(e.marks[1].bar).toBeLessThan(e.marks[2].bar);
  });
});

/** Ramp, then three lower-high / lower-low bars whose last low sits under the 18. */
function runFixture(): { s: Ohlc; runEnd: number } {
  const s = stackedOhlc(60, 2);
  push(s, (e18) => ({ h: e18 + 2.6, l: e18 + 2 }));
  push(s, (e18) => ({ h: e18 + 1.6, l: e18 + 1 }));
  const runEnd = push(s, (e18) => ({ h: e18 + 0.5, l: e18 - 0.05, c: e18 + 0.3, o: e18 + 0.2 }));
  return { s, runEnd };
}

const runSteps: Step[] = [
  { id: 'fan', type: 'fan_up', mode: 'full', hold: true },
  { id: 'run', type: 'pullback', mode: 'run', minBars: 3, lowerHighs: true, lowerLows: true, belowEma: 18, belowField: 'low', nextBarOnly: true },
  { id: 'breakout', type: 'price_vs_ema', ema: 18, field: 'high', dir: 'above' },
];

describe('pullback run + nextBarOnly', () => {
  it('enters on a breakout the very next bar, one mark per step', () => {
    const { s, runEnd } = runFixture();
    const breakout = push(s, (e18) => ({ h: e18 + 1, l: e18 + 0.1, c: e18 + 0.6, o: e18 + 0.4 }));
    pad(s);
    const entries = findStrategyEntries(s, cfg(custom(runSteps)));
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.barIndex).toBe(breakout);
    expect(e.marks.map((m) => [m.stepId, m.bar])).toEqual([['fan', e.marks[0].bar], ['run', runEnd], ['breakout', breakout]]);
    expect(e.fanBar).toBe(runEnd);
    expect(e.trade!.stopPrice).toBeLessThan(s.lows[runEnd]);
  });

  it('resets when the breakout comes two bars later', () => {
    const { s, runEnd } = runFixture();
    // A bar that neither breaks out (high under the 18) nor extends the run (higher low).
    push(s, (e18) => ({ h: e18 - 0.005, l: e18 - 0.03, c: e18 - 0.01, o: e18 - 0.02 }));
    push(s, (e18) => ({ h: e18 + 1, l: e18 + 0.1, c: e18 + 0.6, o: e18 + 0.4 }));
    pad(s);
    const run = runStrategy(s, cfg(custom(runSteps)), { trace: true });
    expect(run.entries).toEqual([]);
    expect(run.trace.some((t) => t.reason === 'max_wait' && t.stepId === 'breakout' && t.bar === runEnd + 1)).toBe(true);
  });

  it('keeps the run alive while it extends, then marks the extended bar', () => {
    const { s, runEnd } = runFixture();
    // Lower high under the 18 (no breakout), lower low, still below → extends the run.
    const extended = push(s, (e18) => ({ h: e18 - 0.02, l: e18 - 0.4, c: e18 - 0.1, o: e18 - 0.05 }));
    const breakout = push(s, (e18) => ({ h: e18 + 1, l: e18 + 0.1, c: e18 + 0.6, o: e18 + 0.4 }));
    pad(s);
    const entries = findStrategyEntries(s, cfg(custom(runSteps)));
    expect(entries).toHaveLength(1);
    expect(extended).toBe(runEnd + 1);
    expect(entries[0].marks[1].bar).toBe(extended);
    expect(entries[0].barIndex).toBe(breakout);
  });
});

/**
 * Steer the 18−50 gap bar by bar: closes are solved from the EMA recurrence so
 * that (e18 − e50) lands on each target. Starts from a gentle rise so
 * 50 > 100 > 200 holds throughout.
 */
function whipsawFixture(targets: number[]): { s: Ohlc; bars: number[] } {
  const c: number[] = [...Array(200).fill(100), ...Array.from({ length: 40 }, (_, i) => 100 + (i + 1) * 0.2)];
  const s: Ohlc = { ticker: 'WHIP', name: 'Whipsaw', closes: c, opens: [], highs: [], lows: [] };
  s.opens = c.map((x) => x - 0.05);
  s.highs = c.map((x) => x + 0.1);
  s.lows = c.map((x) => x - 0.1);
  const k1 = 2 / 19;
  const k2 = 2 / 51;
  const bars: number[] = [];
  for (const gap of targets) {
    const n = s.closes.length;
    const e18 = ema(s.closes, 18)[n - 1];
    const e50 = ema(s.closes, 50)[n - 1];
    const close = (gap - (1 - k1) * e18 + (1 - k2) * e50) / (k1 - k2);
    s.closes.push(close);
    s.opens.push(close - 0.05);
    s.highs.push(close + 0.1);
    s.lows.push(close - 0.1);
    bars.push(n);
  }
  return { s, bars };
}

/** Turn bar `i` into a Bunn reversal on the 100 (body above, tail through it and the prior low). */
function bunnOn100(s: Ohlc, i: number) {
  const e100 = ema(s.closes, 100)[i];
  s.lows[i] = Math.min(e100, s.lows[i - 1]) - 0.3;
}

describe('ema_cross is an instant step and a hold reset does not swallow its bar', () => {
  // gaps: cross down (D1), drift, cross up (U), cross down again (D2), drift, bounce (B), cross up (R), fill
  const GAPS = [-0.3, -0.4, -0.5, -0.5, -0.4, 0.05, -0.05, -0.2, -0.3, -0.2, 0.1, 0.2, 0.2, 0.2];
  const [D1, , , , , U, D2, , , B, R, F] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  it('starts the episode on the second cross-down, the bar the lagged hold breaks on', () => {
    const { s, bars } = whipsawFixture(GAPS);
    bunnOn100(s, bars[B]);
    s.highs[bars[F]] = s.highs[bars[R]] + 0.1;
    const e18 = ema(s.closes, 18);
    const e50 = ema(s.closes, 50);
    expect(crossDown18_50(e18, e50, bars[D1])).toBe(true);
    expect(crossUp18_50(e18, e50, bars[U])).toBe(true);
    expect(crossDown18_50(e18, e50, bars[D2])).toBe(true);
    expect(crossUp18_50(e18, e50, bars[R])).toBe(true);

    const run = runStrategy(s, contCfg, { trace: true });
    expect(run.trace.some((t) => t.reason === 'hold' && t.stepId === 'adverse' && t.bar === bars[D2])).toBe(true);
    expect(run.entries).toHaveLength(1);
    const e = run.entries[0];
    expect(e.marks.map((m) => m.bar)).toEqual([bars[D2], bars[D2], bars[B], bars[R]]);
    expect(e.barIndex).toBe(bars[F]);
    expect(e.entryPrice).toBeCloseTo(s.highs[bars[R]] + BUNN_PENNY, 8);
  });

  it('accepts a reversal on the cross-down bar itself and a resume on the reversal bar', () => {
    const { s, bars } = whipsawFixture([-0.3, -0.4, -0.3, 0.1, 0.2, 0.2, 0.2]);
    const [D, , B2, R2, F2] = [0, 1, 2, 3, 4];
    bunnOn100(s, bars[D]);
    bunnOn100(s, bars[B2]);
    // The later bounce refreshes the mark; the bar after it crosses up. Also try the
    // same-bar case: make the resume bar itself the (refreshed) reversal.
    bunnOn100(s, bars[R2]);
    s.highs[bars[F2]] = s.highs[bars[R2]] + 0.1;
    const run = runStrategy(s, contCfg, { trace: true });
    expect(run.entries).toHaveLength(1);
    const e = run.entries[0];
    expect(e.marks[0].bar).toBe(bars[D]);
    expect(e.marks[2].bar).toBe(bars[R2]);
    expect(e.marks[3].bar).toBe(bars[R2]);
    expect(e.trade!.stopPrice).toBeCloseTo(s.lows[bars[R2]] - BUNN_PENNY, 8);
  });
});
