import { describe, it, expect } from 'vitest';
import {
  classifyFan,
  classifyFanSeries,
  classifyCloses,
  screenFan,
  ema200RisingAt,
  ema200AgoOf,
  FAN_NEAR_MARGIN,
  FAN_ENTER_LOOKBACK,
  type FanSubject,
} from './fan.ts';

const stacked = { ema18: 110, ema50: 100, ema100: 90, ema200: 80 };

function subject(ticker: string, closes: number[], vols?: number[]): FanSubject {
  const v = vols ?? closes.map(() => 1_000_000);
  return {
    ticker,
    name: ticker,
    sector: 'Tech',
    price: closes[closes.length - 1],
    changePct: 0,
    sparkline: closes.slice(-40),
    full: { c: closes, v },
    avgVol20: 1_000_000,
    relVol: 1,
    marketCap: 5e9,
  };
}

describe('classifyFan (latest-bar geometry)', () => {
  it('matches a strict 18 > 50 > 100 > 200 stack', () => {
    const c = classifyFan(stacked);
    expect(c.status).toBe('match');
    expect(c.worstGap).toBeGreaterThan(0);
  });

  it('treats equal adjacent EMAs as geometrically close, not a match', () => {
    const c = classifyFan({ ...stacked, ema18: 100 });
    expect(c.status).toBe('near');
    expect(c.worstGap).toBe(0);
  });

  it('counts a worst-pair inversion within 0.5% as geometrically close', () => {
    const c = classifyFan({ ...stacked, ema18: 99.6 });
    expect(c.status).toBe('near');
    expect(c.worstGap).toBeCloseTo(-0.004, 8);
    expect(c.worstGap).toBeGreaterThanOrEqual(-FAN_NEAR_MARGIN);
  });

  it('rejects an inversion outside the 0.5% margin', () => {
    const c = classifyFan({ ...stacked, ema18: 99.4 });
    expect(c.status).toBe('none');
    expect(c.worstGap).toBeCloseTo(-0.006, 8);
  });

  it('does not treat a wildly broken long stack as close just because two pairs hold', () => {
    const c = classifyFan({ ema18: 110, ema50: 100, ema100: 90, ema200: 100 });
    expect(c.status).toBe('none');
    expect(c.worstGap).toBeCloseTo(-0.10, 8);
  });

  it('returns none when a slower EMA is zero', () => {
    const c = classifyFan({ ema18: 1, ema50: 0, ema100: 1, ema200: 1 });
    expect(c.status).toBe('none');
  });
});

describe('classifyFanSeries — entering after being out', () => {
  function emaSeries(last18: number, prior18: number, e50 = 100, e100 = 90, e200 = 80) {
    const n = FAN_ENTER_LOOKBACK + 5;
    return {
      e18: Array.from({ length: n }, (_, i) => (i === n - 1 ? last18 : prior18)),
      e50: Array(n).fill(e50),
      e100: Array(n).fill(e100),
      e200: Array(n).fill(e200),
    };
  }

  it('is near when close to stacking and the worst gap is improving', () => {
    const s = emaSeries(99.7, 98);
    const c = classifyFanSeries(s.e18, s.e50, s.e100, s.e200);
    expect(c.status).toBe('near');
    expect(c.worstGap).toBeCloseTo(-0.003, 8);
  });

  it('is not near when the name just left a fan (gap worsening)', () => {
    const s = emaSeries(99.7, 101);
    expect(classifyFanSeries(s.e18, s.e50, s.e100, s.e200).status).toBe('none');
  });

  it('is not near when close but not improving', () => {
    const s = emaSeries(99.7, 99.7);
    expect(classifyFanSeries(s.e18, s.e50, s.e100, s.e200).status).toBe('none');
  });

  it('is not near with too little history to have been out of a fan', () => {
    expect(classifyFanSeries([99.6], [100], [90], [80]).status).toBe('none');
  });

  it('still matches a stack on the last bar', () => {
    const s = emaSeries(110, 110);
    expect(classifyFanSeries(s.e18, s.e50, s.e100, s.e200).status).toBe('match');
  });
});

describe('screenFan', () => {
  it('splits match / near with no overlap and sorts closest-first', () => {
    const rising = Array.from({ length: 250 }, (_, i) => 10 + i * 0.4);
    const alsoRising = Array.from({ length: 250 }, (_, i) => 20 + i * 0.2);
    const { matches, near } = screenFan([
      subject('AAA', rising),
      subject('BBB', alsoRising),
    ]);
    const tickers = new Set([...matches, ...near].map((r) => r.ticker));
    expect(tickers.size).toBe(matches.length + near.length);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].worstGap).toBeGreaterThanOrEqual(matches[i].worstGap);
    }
    for (let i = 1; i < near.length; i++) {
      expect(near[i - 1].worstGap).toBeGreaterThanOrEqual(near[i].worstGap);
    }
  });

  it('skips names with no closes', () => {
    const { matches, near } = screenFan([subject('EMPTY', [])]);
    expect(matches).toEqual([]);
    expect(near).toEqual([]);
  });

  it('attaches 200-EMA values from 1/3/5 months ago', () => {
    const rising = Array.from({ length: 250 }, (_, i) => 10 + i * 0.4);
    const { matches } = screenFan([subject('AAA', rising)]);
    expect(matches.length).toBe(1);
    expect(matches[0].ema200Ago[21]).not.toBeNull();
    expect(matches[0].ema200).toBeGreaterThan(matches[0].ema200Ago[21]!);
  });
});

describe('ema200RisingAt', () => {
  it('is off when lookback is 0', () => {
    expect(ema200RisingAt([3, 2, 1], 2, 0)).toBe(true);
  });

  it('is true when the 200-EMA is higher than N bars ago', () => {
    const e200 = [10, 10.1, 10.2, 10.4];
    expect(ema200RisingAt(e200, 3, 3)).toBe(true);
    expect(ema200RisingAt(e200, 3, 1)).toBe(true);
  });

  it('is false when the 200-EMA is flat, falling, or history is too short', () => {
    expect(ema200RisingAt([10, 10, 10], 2, 2)).toBe(false);
    expect(ema200RisingAt([10, 9.5, 9], 2, 2)).toBe(false);
    expect(ema200RisingAt([10, 11], 1, 21)).toBe(false);
  });

  it('snapshots 1/3/5-month ago values from the last bar', () => {
    const e200 = Array.from({ length: 110 }, (_, i) => 50 + i * 0.01);
    const ago = ema200AgoOf(e200);
    expect(ago[21]).toBeCloseTo(e200[e200.length - 1 - 21], 8);
    expect(ago[63]).toBeCloseTo(e200[e200.length - 1 - 63], 8);
    expect(ago[105]).toBeCloseTo(e200[e200.length - 1 - 105], 8);
  });
});

describe('classifyCloses', () => {
  it('matches a long rising series', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 10 + i * 0.4);
    expect(classifyCloses(closes).status).toBe('match');
  });

  it('does not call a 1-bar series near just because all EMAs equal the close', () => {
    expect(classifyCloses([42]).status).toBe('none');
  });
});
