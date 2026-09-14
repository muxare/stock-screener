// screen/sort.ts — client-side ordering for the screener tables.
//
// The server already returns every match/near row, so sorting never costs a
// round trip. Pure functions over an injected accessor so the signal table's
// own columns (entry, stop, R, age) sort through the same code as the fields.
//
// Rules, in order:
//   1. missing values (null / undefined / NaN / '') sink to the bottom in BOTH
//      directions — a name without RSI is never "the best RSI";
//   2. numbers compare numerically, strings with localeCompare;
//   3. ties break on the tiebreak key (the ticker) ascending, so the order is
//      stable and identical whichever way the list arrived.

export type SortKey = string;

export interface SortState {
  field: SortKey;
  dir: 'asc' | 'desc';
}

export type SortValue = number | string | null | undefined;

function missing(v: SortValue): boolean {
  if (v == null) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  return v === '';
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Toggle the sort for `field`: a new field starts descending for numbers
 * (biggest first is what a screener wants) or ascending for text; clicking the
 * current field flips the direction.
 */
export function toggleSort(current: SortState | null, field: SortKey, startDir: 'asc' | 'desc' = 'desc'): SortState {
  if (current && current.field === field) {
    return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { field, dir: startDir };
}

/**
 * A new array of `rows` in `sort` order. `valueOf` supplies the cell value for
 * the sorted field; `tiebreak` (the ticker) settles equal values.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  valueOf: (row: T, field: SortKey) => SortValue,
  tiebreak: (row: T) => string,
): T[] {
  const out = rows.slice();
  if (!sort) return out;
  const sign = sort.dir === 'asc' ? 1 : -1;
  out.sort((ra, rb) => {
    const a = valueOf(ra, sort.field);
    const b = valueOf(rb, sort.field);
    const ma = missing(a);
    const mb = missing(b);
    if (ma || mb) {
      if (ma && mb) return tiebreak(ra).localeCompare(tiebreak(rb));
      return ma ? 1 : -1;
    }
    const c = compare(a, b);
    return c !== 0 ? c * sign : tiebreak(ra).localeCompare(tiebreak(rb));
  });
  return out;
}
