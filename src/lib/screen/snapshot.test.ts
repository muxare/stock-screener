import { describe, it, expect } from 'vitest';
import {
  buildSnapshot,
  EMPTY_SNAPSHOT,
  PERF_1M_BARS,
  PERF_3M_BARS,
  RSI_PERIOD,
  WEEK52_BARS,
} from './snapshot.ts';
import { atr14, rsi, stochRsi } from '../indicators.ts';

/** A gentle ramp with a little wobble, long enough for every lookback. */
function ramp(n: number, start = 50, step = 0.2): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step + Math.sin(i / 3) * 0.4);
}

function bars(closes: number[]) {
  return {
    closes,
    volumes: closes.map((_, i) => 100_000 + i * 10),
    highs: closes.map((c) => c + 0.5),
    lows: closes.map((c) => c - 0.5),
  };
}

describe('buildSnapshot', () => {
  it('reads the last bar of the same indicators.ts series the chart uses', () => {
    const closes = ramp(300);
    const input = bars(closes);
    const s = buildSnapshot(input);
    const n = closes.length - 1;

    const rsiArr = rsi(closes, RSI_PERIOD);
    const stoch = stochRsi(rsiArr, RSI_PERIOD, 3, 3);
    expect(s.rsi14).toBe(rsiArr[n]);
    expect(s.stochK).toBe(stoch.k[n]);
    expect(s.stochD).toBe(stoch.d[n]);
    expect(s.atrPct).toBe(atr14(input.highs, input.lows, closes)[n] / closes[n]);
    expect(s.volume).toBe(input.volumes[n]);
  });

  it('measures performance as a fraction over 21 and 63 bars', () => {
    const closes = ramp(300);
    const s = buildSnapshot(bars(closes));
    const n = closes.length - 1;
    expect(s.perf1m).toBeCloseTo(closes[n] / closes[n - PERF_1M_BARS] - 1, 12);
    expect(s.perf3m).toBeCloseTo(closes[n] / closes[n - PERF_3M_BARS] - 1, 12);
  });

  it('takes the 52-week extremes from the last 252 bars, not the whole history', () => {
    const closes = [999, ...ramp(WEEK52_BARS + 40)];
    const s = buildSnapshot(bars(closes));
    expect(s.hi52).toBeLessThan(999);
    const window = closes.slice(-WEEK52_BARS);
    expect(s.hi52).toBeCloseTo(Math.max(...window) + 0.5, 12);
    expect(s.lo52).toBeCloseTo(Math.min(...window) - 0.5, 12);
  });

  it('falls back to closes for the 52-week extremes when there are no highs/lows', () => {
    const closes = ramp(120);
    const s = buildSnapshot({ closes });
    expect(s.hi52).toBe(Math.max(...closes));
    expect(s.lo52).toBe(Math.min(...closes));
    expect(s.atrPct).toBeNaN();
  });

  it('is NaN, never a placeholder, when the history is too short', () => {
    const closes = ramp(10);
    const s = buildSnapshot(bars(closes));
    expect(s.rsi14).toBeNaN();
    expect(s.stochK).toBeNaN();
    expect(s.stochD).toBeNaN();
    expect(s.perf1m).toBeNaN();
    expect(s.perf3m).toBeNaN();
    // ATR and the extremes are computable from any number of bars.
    expect(Number.isFinite(s.atrPct)).toBe(true);
    expect(Number.isFinite(s.hi52)).toBe(true);
  });

  it('needs more than the RSI period before it reports an RSI', () => {
    expect(buildSnapshot(bars(ramp(RSI_PERIOD))).rsi14).toBeNaN();
    expect(Number.isFinite(buildSnapshot(bars(ramp(RSI_PERIOD + 1))).rsi14)).toBe(true);
  });

  it('leaves stoch RSI missing until its whole RSI window is real', () => {
    // The stochastic ranks RSI inside a 14-bar window, so it needs 2 x the
    // period of closes; before that the window is backfilled warm-up values.
    expect(buildSnapshot(bars(ramp(RSI_PERIOD + 4))).stochK).toBeNaN();
    expect(buildSnapshot(bars(ramp(RSI_PERIOD * 2))).stochK).toBeNaN();
    expect(Number.isFinite(buildSnapshot(bars(ramp(RSI_PERIOD * 2 + 1))).stochK)).toBe(true);
    expect(Number.isFinite(buildSnapshot(bars(ramp(80))).stochD)).toBe(true);
  });

  it('has no volume without a volume column of matching length', () => {
    const closes = ramp(300);
    expect(buildSnapshot({ closes }).volume).toBeNaN();
    expect(buildSnapshot({ closes, volumes: [1, 2, 3] }).volume).toBeNaN();
  });

  it('returns the empty snapshot for a nameless series', () => {
    expect(buildSnapshot({ closes: [] })).toEqual(EMPTY_SNAPSHOT);
  });
});
