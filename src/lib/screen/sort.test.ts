import { describe, it, expect } from 'vitest';
import { sortRows, toggleSort, type SortValue } from './sort.ts';

interface Row { ticker: string; n?: number | null; s?: string }

const rows: Row[] = [
  { ticker: 'CCC', n: 2, s: 'beta' },
  { ticker: 'AAA', n: 10, s: 'alpha' },
  { ticker: 'BBB', n: 2, s: 'gamma' },
  { ticker: 'DDD', n: NaN, s: '' },
  { ticker: 'EEE', n: null },
];

const valueOf = (r: Row, field: string): SortValue => (field === 's' ? r.s : r.n);
const tick = (r: Row) => r.ticker;
const order = (out: Row[]) => out.map((r) => r.ticker);

describe('sortRows', () => {
  it('sorts numbers descending and ascending', () => {
    expect(order(sortRows(rows, { field: 'n', dir: 'desc' }, valueOf, tick)))
      .toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
    expect(order(sortRows(rows, { field: 'n', dir: 'asc' }, valueOf, tick)))
      .toEqual(['BBB', 'CCC', 'AAA', 'DDD', 'EEE']);
  });

  it('keeps NaN and null last in both directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const out = order(sortRows(rows, { field: 'n', dir }, valueOf, tick));
      expect(out.slice(-2)).toEqual(['DDD', 'EEE']);
    }
  });

  it('breaks ties on the tiebreak key, ascending, whichever direction', () => {
    expect(order(sortRows(rows, { field: 'n', dir: 'desc' }, valueOf, tick)).slice(1, 3))
      .toEqual(['BBB', 'CCC']);
    expect(order(sortRows(rows, { field: 'n', dir: 'asc' }, valueOf, tick)).slice(0, 2))
      .toEqual(['BBB', 'CCC']);
  });

  it('is stable for a shuffled input', () => {
    const shuffled = [rows[2], rows[4], rows[0], rows[3], rows[1]];
    expect(order(sortRows(shuffled, { field: 'n', dir: 'desc' }, valueOf, tick)))
      .toEqual(order(sortRows(rows, { field: 'n', dir: 'desc' }, valueOf, tick)));
  });

  it('sorts strings with localeCompare and treats the empty string as missing', () => {
    expect(order(sortRows(rows, { field: 's', dir: 'asc' }, valueOf, tick)))
      .toEqual(['AAA', 'CCC', 'BBB', 'DDD', 'EEE']);
  });

  it('copies rather than sorting in place, and passes through with no sort', () => {
    const input = rows.slice();
    const out = sortRows(input, null, valueOf, tick);
    expect(order(input)).toEqual(order(rows));
    expect(order(out)).toEqual(order(rows));
    expect(out).not.toBe(input);
  });
});

describe('toggleSort', () => {
  it('starts a new numeric field descending and a text field ascending', () => {
    expect(toggleSort(null, 'n')).toEqual({ field: 'n', dir: 'desc' });
    expect(toggleSort(null, 's', 'asc')).toEqual({ field: 's', dir: 'asc' });
  });

  it('flips the direction of the field already sorted', () => {
    expect(toggleSort({ field: 'n', dir: 'desc' }, 'n')).toEqual({ field: 'n', dir: 'asc' });
    expect(toggleSort({ field: 'n', dir: 'asc' }, 'n')).toEqual({ field: 'n', dir: 'desc' });
  });

  it('switching fields starts fresh rather than inheriting the direction', () => {
    expect(toggleSort({ field: 'n', dir: 'asc' }, 's', 'asc')).toEqual({ field: 's', dir: 'asc' });
  });
});
