import { describe, it, expect } from 'vitest';
import { simulateRTrade } from './trade.ts';
import { BUNN_PENNY, BUNN_WINDOW_LO } from './primitives.ts';
import type { ExitSpec } from './types.ts';

const HARD: ExitSpec = {
  targetR: 3, targetWindow: false, trailEma: null, trailPivot: false,
  breakevenAtR: null, maxHoldBars: null, macdExit: false, fanExit: 'slow',
};

describe('simulateRTrade', () => {
  const n = 10;
  const flat = Array(n).fill(100);
  const emas = { e18: flat, e50: Array(n).fill(95), e100: Array(n).fill(90), e200: Array(n).fill(80) };
  const macd = { line: Array(n).fill(1), signal: Array(n).fill(0), hist: Array(n).fill(1) };
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
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, HARD);
    expect(trade?.exitReason).toBe('stop_r');
    expect(trade?.realizedR).toBe(-1);
  });

  it('takes 3R when the high tags the target', () => {
    const bars = {
      o: flat, c: [...Array(3).fill(100), 116, ...Array(6).fill(116)],
      h: [...Array(3).fill(100), 116, ...Array(6).fill(116)],
      l: Array(n).fill(99),
    };
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, HARD);
    expect(trade?.exitReason).toBe('target_r');
    expect(trade?.realizedR).toBe(3);
  });

  it('exits at 2.5R when the target window is on', () => {
    const bars = {
      o: flat, c: [...Array(3).fill(100), 112.5, ...Array(6).fill(112.5)],
      h: [...Array(3).fill(100), 112.5, ...Array(6).fill(112.5)],
      l: Array(n).fill(99),
    };
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, { ...HARD, targetWindow: true });
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
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, { ...HARD, targetWindow: true });
    expect(trade?.exitReason).toBe('stop_r');
    expect(trade?.realizedR).toBe(-1);
  });

  it('moves the stop to breakeven after 1R and exits there on a pullback', () => {
    const bars = {
      o: flat, c: flat,
      h: [100, 100, 106, 104, 100, 100, 100, 100, 100, 100],
      l: [100, 100, 99, 99.5, 100, 100, 100, 100, 100, 100],
    };
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, { ...HARD, breakevenAtR: 1 });
    expect(trade?.exitReason).toBe('breakeven');
    expect(trade?.realizedR).toBeCloseTo(0);
  });

  it('trails under the 50-EMA after breakeven', () => {
    const e50 = [95, 95, 96, 101, 102, 102, 102, 102, 102, 102];
    const bars = {
      o: flat, c: flat,
      h: [100, 100, 106, 108, 108, 108, 108, 108, 108, 108],
      l: [100, 100, 99.5, 100.5, 100.8, 100, 100, 100, 100, 100],
    };
    const trade = simulateRTrade(bars, { ...emas, e50 }, macd, 1, 95, 115, { ...HARD, breakevenAtR: 1, trailEma: 50 });
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
    const trade = simulateRTrade(bars, emas, bear, 1, 95, 115, { ...HARD, macdExit: true });
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
    const trade = simulateRTrade(bars, { ...emas, e50 }, bear, 1, 95, 115, { ...HARD, macdExit: true, breakevenAtR: 1, trailEma: 50 });
    expect(trade?.exitReason).toBe('trail');
  });

  it('flattens when the full fan breaks under fanExit=full', () => {
    const len = 6;
    const bars = { o: Array(len).fill(100), c: Array(len).fill(100), h: Array(len).fill(101), l: Array(len).fill(99) };
    const broken = { ...emas12(len), e18: [100, 100, 100, 90, 90, 90] };
    const full = simulateRTrade(bars, broken, macd12(len), 1, 95, 115, { ...HARD, fanExit: 'full' });
    expect(full?.exitReason).toBe('fan_break');
    expect(full?.exitBar).toBe(3);
    const slow = simulateRTrade(bars, broken, macd12(len), 1, 95, 115, { ...HARD, fanExit: 'slow' });
    expect(slow?.exitReason).toBe('end_of_data');
  });

  it('ratchets the stop 2¢ under a pivot confirmed after entry, then trails out', () => {
    const n = 12;
    const px = Array(n).fill(100);
    const bars = {
      o: px, c: px,
      h: [100, 100, 101, 100, 100.5, 102, 102, 102, 102, 100, 100, 100],
      l: [100, 100, 100, 98, 100, 99, 99, 97.9, 97.9, 97.9, 97.9, 97.9],
    };
    const trade = simulateRTrade(bars, emas12(n), macd12(n), 1, 95, 115, { ...HARD, trailPivot: true });
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
    const trade = simulateRTrade(bars, emas12(n), macd12(n), 5, 95, 115, { ...HARD, trailPivot: true });
    expect(trade?.exitReason).toBe('stop_r');
    expect(trade?.exitPrice).toBe(95);
    expect(trade?.realizedR).toBe(-1);
  });

  it('does not cut a pivot-trailed trade on a MACD flip', () => {
    const n = 12;
    const px = Array(n).fill(100);
    const bear = { line: Array(n).fill(-1), signal: Array(n).fill(0), hist: Array(n).fill(-1) };
    const bars = {
      o: px, c: px,
      h: [100, 100, 101, 100, 100.5, 102, 102, 102, 102, 100, 100, 100],
      l: [100, 100, 100, 98, 100, 99, 99, 97.9, 97.9, 97.9, 97.9, 97.9],
    };
    const trade = simulateRTrade(bars, emas12(n), bear, 1, 95, 115, { ...HARD, trailPivot: true, macdExit: true });
    expect(trade?.exitReason).toBe('pivot_trail');
  });

  it('does not cut a pivot trail on max hold while the slow fan holds', () => {
    const n = 12;
    const px = Array(n).fill(100);
    const bars = {
      o: px, c: px,
      h: [100, 100, 101, 100, 100.5, 102, 102, 102, 102, 100, 100, 100],
      l: [100, 100, 100, 98, 100, 99, 99, 97.9, 97.9, 97.9, 97.9, 97.9],
    };
    const trade = simulateRTrade(bars, emas12(n), macd12(n), 1, 95, 115, { ...HARD, trailPivot: true, maxHoldBars: 2 });
    expect(trade?.exitReason).toBe('pivot_trail');
  });

  it('exits on max hold when not trailing', () => {
    const bars = { o: flat, c: flat, h: Array(n).fill(101), l: Array(n).fill(99) };
    const trade = simulateRTrade(bars, emas, macd, 1, 95, 115, { ...HARD, maxHoldBars: 3 });
    expect(trade?.exitReason).toBe('max_hold');
    expect(trade?.exitBar).toBe(4);
  });
});
