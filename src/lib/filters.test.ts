import { describe, it, expect } from 'vitest';
import { applyFanFilters, DEFAULT_FAN_FILTERS, fmtCompact } from './filters';
import type { Ema200Ago, FanRow } from './fan';
import { EMPTY_SNAPSHOT } from './screen/snapshot';

function risingAgo(now: number): Ema200Ago {
  return { 21: now - 0.2, 63: now - 0.5, 105: now - 0.8 };
}

function row(partial: Partial<FanRow> & Pick<FanRow, 'ticker'>): FanRow {
  const ema200 = partial.ema200 ?? 1;
  return {
    name: partial.ticker,
    sector: 'Tech',
    price: 50,
    changePct: 0,
    ema18: 4, ema50: 3, ema100: 2, ema200,
    ema200Ago: risingAgo(ema200),
    worstGap: 0.1,
    sparkline: [1],
    snapshot: EMPTY_SNAPSHOT,
    avgVol20: 500_000,
    relVol: 1.2,
    marketCap: 2e9,
    ...partial,
  };
}

const off = { ...DEFAULT_FAN_FILTERS, ema200RisingBars: 0 };

describe('applyFanFilters', () => {
  const rows = [
    row({ ticker: 'BIG', avgVol20: 2e6, marketCap: 20e9, price: 100, sector: 'Tech' }),
    row({ ticker: 'MID', avgVol20: 400_000, marketCap: 800e6, price: 12, sector: 'Healthcare' }),
    row({ ticker: 'SMALL', avgVol20: 50_000, marketCap: null, price: 3, sector: 'Tech' }),
  ];

  it('passes all rows with volume/cap/price/sector off', () => {
    expect(applyFanFilters(rows, off)).toHaveLength(3);
  });

  it('filters by minimum average volume', () => {
    const out = applyFanFilters(rows, { ...off, minAvgVol: 250_000 });
    expect(out.map((r) => r.ticker)).toEqual(['BIG', 'MID']);
  });

  it('filters by market cap and excludes unknown caps', () => {
    const out = applyFanFilters(rows, { ...off, minMarketCap: 1e9 });
    expect(out.map((r) => r.ticker)).toEqual(['BIG']);
  });

  it('filters by sector and minimum price together', () => {
    const out = applyFanFilters(rows, { ...off, minPrice: 10, sector: 'Tech' });
    expect(out.map((r) => r.ticker)).toEqual(['BIG']);
  });

  it('keeps names whose 200-EMA is higher than 1 month ago', () => {
    const rising = row({ ticker: 'UP', ema200: 10, ema200Ago: { 21: 9.5, 63: 9, 105: 8 } });
    const falling = row({ ticker: 'DOWN', ema200: 10, ema200Ago: { 21: 10.4, 63: 11, 105: 12 } });
    const unknown = row({ ticker: 'NEW', ema200: 10, ema200Ago: { 21: null, 63: null, 105: null } });
    const out = applyFanFilters([rising, falling, unknown], { ...off, ema200RisingBars: 21 });
    expect(out.map((r) => r.ticker)).toEqual(['UP']);
  });
});

describe('fmtCompact', () => {
  it('formats large numbers compactly', () => {
    expect(fmtCompact(1_500_000)).toBe('1.5M');
    expect(fmtCompact(3_400_000_000)).toBe('3.4B');
  });
});
