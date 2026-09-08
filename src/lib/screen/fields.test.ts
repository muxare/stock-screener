import { describe, it, expect } from 'vitest';
import {
  ALL_FIELDS,
  COLUMN_FIELDS,
  fieldOf,
  formatField,
  isFieldId,
  valueOfField,
  type FieldId,
  type ScreenRowLike,
} from './fields.ts';
import { DEFAULT_COLUMNS, orderColumns, toggleColumn } from './columns.ts';
import { EMPTY_SNAPSHOT } from './snapshot.ts';
import { TOPICS } from '../../help/glossary.ts';

function row(over: Partial<ScreenRowLike> = {}): ScreenRowLike {
  return {
    ticker: 'AAA',
    name: 'Alpha Inc',
    sector: 'Tech',
    price: 123.456,
    changePct: -1.234,
    avgVol20: 1_500_000,
    marketCap: 3_400_000_000,
    snapshot: { ...EMPTY_SNAPSHOT, volume: 2_250_000, rsi14: 57.44, stochK: 18.2, perf1m: 0.0251, atrPct: 0.0312 },
    relVol: 1.5,
    ema18: 120.5,
    worstGap: 0.0025,
    sparkline: [1, 2],
    ...over,
  };
}

describe('field registry', () => {
  it('has a unique id per field and resolves them all', () => {
    const ids = ALL_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(fieldOf(id)?.id).toBe(id);
    expect(isFieldId('rsi14')).toBe(true);
    expect(isFieldId('nope')).toBe(false);
  });

  it('resolves every help id it declares to a glossary topic', () => {
    for (const f of ALL_FIELDS) {
      if (!f.help) continue;
      expect(TOPICS.has(f.help), `${f.id} → ${f.help}`).toBe(true);
    }
  });

  it('formats each unit exactly once, and missing values as the em dash', () => {
    const r = row();
    expect(formatField('price', r)).toBe('123.46');
    expect(formatField('changePct', r)).toBe('-1.23%');   // already percent units
    expect(formatField('worstGap', r)).toBe('0.25%');     // a fraction
    expect(formatField('atrPct', r)).toBe('3.12%');
    expect(formatField('marketCap', r)).toBe('3.4B');
    expect(formatField('volume', r)).toBe('2.3M');
    expect(formatField('rsi14', r)).toBe('57.4');
    expect(formatField('relVol', r)).toBe('1.50');
    expect(formatField('sector', r)).toBe('Tech');
    expect(formatField('stochD', r)).toBe('—');
    expect(formatField('ema50', r)).toBe('—');
  });

  it('derives rel vol from the snapshot when the row does not carry it', () => {
    const r = row({ relVol: undefined, avgVol20: 1_000_000 });
    expect(valueOfField('relVol', r)).toBeCloseTo(2.25, 10);
    expect(valueOfField('relVol', row({ relVol: undefined, avgVol20: 0 }))).toBeNull();
  });

  it('reports missing numbers as null so sorting can sink them', () => {
    expect(valueOfField('ema200', row())).toBeNull();
    expect(valueOfField('rsi14', row({ snapshot: EMPTY_SNAPSHOT }))).toBeNull();
    expect(valueOfField('marketCap', row({ marketCap: null }))).toBeNull();
  });
});

describe('column defaults', () => {
  it('defaults to visible, showable fields in registry order', () => {
    expect(DEFAULT_COLUMNS.fan).toEqual(orderColumns(DEFAULT_COLUMNS.fan));
    for (const id of DEFAULT_COLUMNS.fan) expect(fieldOf(id)?.column).toBe(true);
    expect(DEFAULT_COLUMNS.fan).toContain('worstGap');
    // Entries bring their own trade columns, so the fan geometry is off there.
    expect(DEFAULT_COLUMNS.entries).not.toContain('worstGap');
    expect(DEFAULT_COLUMNS.entries).toContain('rsi14');
  });

  it('only offers columns that can be columns', () => {
    expect(COLUMN_FIELDS.every((f) => f.column)).toBe(true);
    expect(COLUMN_FIELDS.map((f) => f.id)).not.toContain('ema200Rising');
  });

  it('toggles a column off and back into its declared position', () => {
    const off = toggleColumn(DEFAULT_COLUMNS.fan, 'rsi14');
    expect(off).not.toContain('rsi14');
    const back = toggleColumn(off, 'rsi14');
    expect(back).toEqual(DEFAULT_COLUMNS.fan);
  });

  it('will not hide a pinned column or show a filter-only field', () => {
    expect(toggleColumn(DEFAULT_COLUMNS.fan, 'ticker')).toContain('ticker');
    expect(toggleColumn(DEFAULT_COLUMNS.fan, 'ema200Rising' as FieldId)).not.toContain('ema200Rising');
  });
});
