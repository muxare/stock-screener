import { describe, it, expect } from 'vitest';
import {
  applyClauses,
  availableFields,
  barsLabel,
  clauseLabel,
  clauseValueLabel,
  clausesActive,
  defaultFilters,
  filterRows,
  floorsEqual,
  formatFieldInput,
  newClause,
  parseFieldInput,
  removeClause,
  setClause,
  signalFloorsOf,
  type Clause,
  type FilterRow,
  type ScreenFilters,
} from './filters.ts';
import { parseCompact } from './format.ts';
import { EMPTY_SNAPSHOT, type IndicatorSnapshot } from './snapshot.ts';

function row(partial: Partial<FilterRow> & Pick<FilterRow, 'ticker'>): FilterRow {
  const ema200 = partial.ema200 ?? 1;
  return {
    name: partial.ticker,
    sector: 'Tech',
    price: 50,
    changePct: 0,
    ema18: 4, ema50: 3, ema100: 2, ema200,
    ema200Ago: { 21: ema200 - 0.2, 63: ema200 - 0.5, 105: ema200 - 0.8 },
    worstGap: 0.1,
    snapshot: EMPTY_SNAPSHOT,
    avgVol20: 500_000,
    relVol: 1.2,
    marketCap: 2e9,
    ...partial,
  };
}

const snap = (p: Partial<IndicatorSnapshot>): IndicatorSnapshot => ({ ...EMPTY_SNAPSHOT, ...p });
const only = (c: Clause): ScreenFilters => ({ clauses: [c] });
const tickers = (rows: FilterRow[]) => rows.map((r) => r.ticker);

const UNIVERSE = [
  row({ ticker: 'BIG', avgVol20: 2e6, marketCap: 20e9, price: 100, sector: 'Tech' }),
  row({ ticker: 'MID', avgVol20: 400_000, marketCap: 800e6, price: 12, sector: 'Healthcare' }),
  row({ ticker: 'SMALL', avgVol20: 50_000, marketCap: null, price: 3, sector: 'Tech' }),
];

describe('parseCompact', () => {
  it('is the inverse of fmtCompact for the suffixes the chips accept', () => {
    expect(parseCompact('300M')).toBe(300_000_000);
    expect(parseCompact('1.2b')).toBe(1_200_000_000);
    expect(parseCompact('400K')).toBe(400_000);
    expect(parseCompact('1.5T')).toBe(1.5e12);
    expect(parseCompact('1,250')).toBe(1250);
    expect(parseCompact(' $20 ')).toBe(20);
    expect(parseCompact('2.5')).toBe(2.5);
    expect(parseCompact('-3')).toBe(-3);
  });

  it('returns null for anything that is not a number', () => {
    expect(parseCompact('')).toBeNull();
    expect(parseCompact('   ')).toBeNull();
    expect(parseCompact('abc')).toBeNull();
    expect(parseCompact('12X')).toBeNull();
    expect(parseCompact('1.2.3')).toBeNull();
  });
});

describe('units follow the field kind', () => {
  it('reads a ratio chip as a fraction and a percent chip as percent units', () => {
    // worstGap / perf / volatility are fractions on the row.
    expect(parseFieldInput('worstGap', '2.5')).toBeCloseTo(0.025, 10);
    expect(parseFieldInput('perf3m', '20')).toBeCloseTo(0.2, 10);
    expect(parseFieldInput('atrPct', '3')).toBeCloseTo(0.03, 10);
    // changePct is ALREADY in percent units — the likeliest bug is converting it.
    expect(parseFieldInput('changePct', '2.5')).toBe(2.5);
    expect(parseFieldInput('price', '20')).toBe(20);
    expect(parseFieldInput('rsi14', '50')).toBe(50);
  });

  it('parses compact input on count fields', () => {
    expect(parseFieldInput('avgVol20', '400K')).toBe(400_000);
    expect(parseFieldInput('marketCap', '1.2B')).toBe(1_200_000_000);
  });

  it('round-trips a bound back into the text the chip shows', () => {
    expect(formatFieldInput('worstGap', 0.025)).toBe('2.5');
    expect(formatFieldInput('changePct', 2.5)).toBe('2.5');
    expect(formatFieldInput('avgVol20', 400_000)).toBe('400K');
    expect(formatFieldInput('marketCap', 1.2e9)).toBe('1.2B');
    expect(formatFieldInput('price', undefined)).toBe('');
  });
});

describe('applyClauses', () => {
  it('passes everything when no clause narrows anything', () => {
    expect(applyClauses(UNIVERSE, { clauses: [] })).toHaveLength(3);
    expect(applyClauses(UNIVERSE, only({ field: 'price', kind: 'range' }))).toHaveLength(3);
    expect(applyClauses(UNIVERSE, only({ field: 'sector', kind: 'in', values: [] }))).toHaveLength(3);
  });

  it('filters on an open-ended minimum', () => {
    expect(tickers(applyClauses(UNIVERSE, only({ field: 'avgVol20', kind: 'range', min: 250_000 }))))
      .toEqual(['BIG', 'MID']);
  });

  it('filters on an open-ended maximum', () => {
    expect(tickers(applyClauses(UNIVERSE, only({ field: 'price', kind: 'range', max: 20 }))))
      .toEqual(['MID', 'SMALL']);
  });

  it('filters on both bounds, inclusive', () => {
    expect(tickers(applyClauses(UNIVERSE, only({ field: 'price', kind: 'range', min: 3, max: 12 }))))
      .toEqual(['MID', 'SMALL']);
  });

  it('drops rows whose value is missing, whichever bound is set', () => {
    const f = only({ field: 'marketCap', kind: 'range', min: 1e9 });
    expect(tickers(applyClauses(UNIVERSE, f))).toEqual(['BIG']); // SMALL has a null cap
    const openEnded = only({ field: 'marketCap', kind: 'range', max: 30e9 });
    expect(tickers(applyClauses(UNIVERSE, openEnded))).toEqual(['BIG', 'MID']);
  });

  it('treats a NaN snapshot field and a null one identically', () => {
    const rows = [
      row({ ticker: 'REAL', snapshot: snap({ rsi14: 58 }) }),
      row({ ticker: 'NAN', snapshot: snap({ rsi14: NaN }) }),
      // What a short-history row looks like after crossing JSON.
      row({ ticker: 'NULL', snapshot: snap({ rsi14: null as unknown as number }) }),
    ];
    const f = only({ field: 'rsi14', kind: 'range', min: 50, max: 65 });
    expect(tickers(applyClauses(rows, f))).toEqual(['REAL']);
  });

  it('compares a ratio clause against the stored fraction', () => {
    const rows = [
      row({ ticker: 'CALM', snapshot: snap({ atrPct: 0.015 }) }),
      row({ ticker: 'WILD', snapshot: snap({ atrPct: 0.06 }) }),
    ];
    const min = parseFieldInput('atrPct', '3')!; // "3%" typed into the chip
    expect(tickers(applyClauses(rows, only({ field: 'atrPct', kind: 'range', min })))).toEqual(['WILD']);
  });

  it('compares a percent clause against percent units', () => {
    const rows = [row({ ticker: 'UP', changePct: 3.1 }), row({ ticker: 'FLAT', changePct: 0.4 })];
    const min = parseFieldInput('changePct', '2.5')!;
    expect(tickers(applyClauses(rows, only({ field: 'changePct', kind: 'range', min })))).toEqual(['UP']);
  });

  it('keeps any of the chosen sectors', () => {
    const f = only({ field: 'sector', kind: 'in', values: ['Tech', 'Healthcare'] });
    expect(tickers(applyClauses(UNIVERSE, f))).toEqual(['BIG', 'MID', 'SMALL']);
    const one = only({ field: 'sector', kind: 'in', values: ['Healthcare'] });
    expect(tickers(applyClauses(UNIVERSE, one))).toEqual(['MID']);
  });

  it('keeps names whose 200-EMA is higher than the chosen lookback', () => {
    const rising = row({ ticker: 'UP', ema200: 10, ema200Ago: { 21: 9.5, 63: 9, 105: 8 } });
    const falling = row({ ticker: 'DOWN', ema200: 10, ema200Ago: { 21: 10.4, 63: 11, 105: 12 } });
    const unknown = row({ ticker: 'NEW', ema200: 10, ema200Ago: { 21: null, 63: null, 105: null } });
    const rows = [rising, falling, unknown];
    expect(tickers(applyClauses(rows, only({ field: 'ema200Rising', kind: 'bars', bars: 21 })))).toEqual(['UP']);
    expect(tickers(applyClauses(rows, only({ field: 'ema200Rising', kind: 'bars', bars: 0 })))).toHaveLength(3);
  });

  it('passes rows that carry no lookbacks — the entries scan enforced the slope', () => {
    const signalish = row({ ticker: 'SIG', ema200Ago: undefined });
    expect(tickers(applyClauses([signalish], only({ field: 'ema200Rising', kind: 'bars', bars: 63 })))).toEqual(['SIG']);
  });

  it('ands every active clause together', () => {
    const f: ScreenFilters = { clauses: [
      { field: 'price', kind: 'range', min: 10 },
      { field: 'sector', kind: 'in', values: ['Tech'] },
    ] };
    expect(tickers(applyClauses(UNIVERSE, f))).toEqual(['BIG']);
  });
});

describe('the default filter set matches the old dropdown behaviour', () => {
  it('is the 1-month slope test and nothing else', () => {
    const f = defaultFilters();
    expect(f.clauses).toEqual([{ field: 'ema200Rising', kind: 'bars', bars: 21 }]);
    expect(clausesActive(f)).toBe(false);
    expect(signalFloorsOf(f)).toEqual({ minAvgVol: 0, minMarketCap: 0, ema200RisingBars: 21 });
  });

  it('drops a name whose 200-EMA is not rising, as the old default did', () => {
    const falling = row({ ticker: 'DOWN', ema200: 10, ema200Ago: { 21: 10.4, 63: 11, 105: 12 } });
    expect(applyClauses([...UNIVERSE, falling], defaultFilters())).toHaveLength(3);
  });

  it('counts any other active clause as active', () => {
    expect(clausesActive(setClause(defaultFilters(), { field: 'price', kind: 'range', min: 5 }))).toBe(true);
    // A clause that only drops rows for a missing value still explains the shrink.
    expect(clausesActive(only({ field: 'rsi14', kind: 'range', max: 30 }))).toBe(true);
    expect(clausesActive(only({ field: 'rsi14', kind: 'range' }))).toBe(false);
  });
});

describe('clause list operations', () => {
  it('replaces the clause on a field rather than adding a second', () => {
    let f = defaultFilters();
    f = setClause(f, { field: 'price', kind: 'range', min: 5 });
    f = setClause(f, { field: 'price', kind: 'range', min: 20, max: 100 });
    expect(f.clauses.filter((c) => c.field === 'price')).toEqual([{ field: 'price', kind: 'range', min: 20, max: 100 }]);
    expect(f.clauses).toHaveLength(2);
  });

  it('removes a clause by field', () => {
    const f = removeClause(defaultFilters(), 'ema200Rising');
    expect(f.clauses).toEqual([]);
  });

  it('starts a new clause in the right shape for the field', () => {
    expect(newClause('sector')).toEqual({ field: 'sector', kind: 'in', values: [] });
    expect(newClause('ema200Rising')).toEqual({ field: 'ema200Rising', kind: 'bars', bars: 21 });
    expect(newClause('rsi14')).toEqual({ field: 'rsi14', kind: 'range' });
  });

  it('offers only filterable fields that are not already used', () => {
    const ids = availableFields(defaultFilters()).map((f) => f.id);
    expect(ids).not.toContain('ema200Rising'); // already a chip
    expect(ids).not.toContain('ticker');       // not filterable
    expect(ids).toContain('rsi14');
    expect(ids).toContain('sector');
  });
});

describe('signalFloorsOf', () => {
  it('projects the three floors the /signals scan takes', () => {
    const f: ScreenFilters = { clauses: [
      { field: 'avgVol20', kind: 'range', min: 400_000 },
      { field: 'marketCap', kind: 'range', min: 1e9, max: 50e9 },
      { field: 'ema200Rising', kind: 'bars', bars: 63 },
      { field: 'rsi14', kind: 'range', min: 50, max: 65 },
    ] };
    expect(signalFloorsOf(f)).toEqual({ minAvgVol: 400_000, minMarketCap: 1e9, ema200RisingBars: 63 });
  });

  it('ignores a clause with only an upper bound — the scan takes floors', () => {
    const f = only({ field: 'avgVol20', kind: 'range', max: 1e6 });
    expect(signalFloorsOf(f).minAvgVol).toBe(0);
  });

  it('is zero for everything when no clause sets a floor', () => {
    expect(signalFloorsOf({ clauses: [] })).toEqual({ minAvgVol: 0, minMarketCap: 0, ema200RisingBars: 0 });
  });

  it('compares floors so a client-side clause does not re-run the scan', () => {
    const base = defaultFilters();
    const withSector = setClause(base, { field: 'sector', kind: 'in', values: ['Tech'] });
    expect(floorsEqual(signalFloorsOf(base), signalFloorsOf(withSector))).toBe(true);
    const withVol = setClause(base, { field: 'avgVol20', kind: 'range', min: 400_000 });
    expect(floorsEqual(signalFloorsOf(base), signalFloorsOf(withVol))).toBe(false);
  });
});

describe('chip labels', () => {
  it('writes each range shape the way the chip shows it', () => {
    expect(clauseValueLabel({ field: 'price', kind: 'range', min: 20, max: 100 })).toBe('20–100');
    expect(clauseValueLabel({ field: 'price', kind: 'range', min: 20 })).toBe('≥ 20');
    expect(clauseValueLabel({ field: 'price', kind: 'range', max: 100 })).toBe('≤ 100');
    expect(clauseValueLabel({ field: 'price', kind: 'range' })).toBe('any');
    expect(clauseValueLabel({ field: 'avgVol20', kind: 'range', min: 400_000 })).toBe('≥ 400K');
    expect(clauseValueLabel({ field: 'atrPct', kind: 'range', min: 0.03 })).toBe('≥ 3%');
  });

  it('writes sectors, the slope and the field label', () => {
    expect(clauseValueLabel({ field: 'sector', kind: 'in', values: [] })).toBe('any');
    expect(clauseValueLabel({ field: 'sector', kind: 'in', values: ['Tech'] })).toBe('Tech');
    expect(clauseValueLabel({ field: 'sector', kind: 'in', values: ['Tech', 'Energy', 'Health'] })).toBe('Tech +2');
    expect(clauseValueLabel({ field: 'ema200Rising', kind: 'bars', bars: 63 })).toBe('rising ≥ 3 months');
    expect(clauseValueLabel({ field: 'ema200Rising', kind: 'bars', bars: 0 })).toBe('any');
    expect(barsLabel(105)).toBe('5 months');
    expect(clauseLabel({ field: 'rsi14', kind: 'range', min: 50, max: 65 })).toBe('RSI 14 50–65');
  });
});

describe('filterRows', () => {
  it('applies the clauses and then the search box', () => {
    const rows = [row({ ticker: 'AAPL', name: 'Apple' }), row({ ticker: 'MSFT', name: 'Microsoft' })];
    expect(tickers(filterRows(rows, 'apple', { clauses: [] }))).toEqual(['AAPL']);
    expect(tickers(filterRows(rows, ' MSF ', { clauses: [] }))).toEqual(['MSFT']);
    expect(filterRows(rows, '', { clauses: [] })).toHaveLength(2);
  });
});
