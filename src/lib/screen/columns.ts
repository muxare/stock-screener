// screen/columns.ts — which columns each view shows, and in what order.
//
// Pure defaults plus the one operation the store needs (toggle a column).
// Kept out of store.ts so the state there stays a value and a setter.

import { ALL_FIELDS, type FieldId } from './fields.ts';

/** The screener's *table shapes* — the column set and sort a list uses. */
export type ScreenView = 'fan' | 'entries';

/**
 * The screener's *row sets* — the visible tab. A different axis from
 * `ScreenView`: `near` is its own list of rows but is shaped like `fan`, so the
 * two share columns and sort. Do not merge them.
 */
export type ScreenTab = 'fan' | 'near' | 'entries';

export const SCREEN_TABS: readonly ScreenTab[] = ['fan', 'near', 'entries'];

/** Which table shape a tab's rows are drawn with. */
export function tableViewOf(tab: ScreenTab): ScreenView {
  return tab === 'entries' ? 'entries' : 'fan';
}

/** Declaration order in fields.ts, so a re-enabled column returns to its place. */
const ORDER = new Map(ALL_FIELDS.map((f, i) => [f.id, i]));

export function orderColumns(ids: readonly FieldId[]): FieldId[] {
  return ids.slice().sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

const FAN_COLUMNS: FieldId[] = ALL_FIELDS.filter((f) => f.column && f.defaultVisible).map((f) => f.id);

/** Entries carry their own entry / stop / R / age columns, so the EMA block is off. */
const ENTRY_COLUMNS: FieldId[] = FAN_COLUMNS.filter(
  (id) => !['ema18', 'ema50', 'ema100', 'ema200', 'worstGap', 'sparkline'].includes(id),
);

export const DEFAULT_COLUMNS: Record<ScreenView, FieldId[]> = {
  fan: FAN_COLUMNS,
  entries: ENTRY_COLUMNS,
};

/** Add or remove one column, keeping the declaration order. Pinned fields stay. */
export function toggleColumn(columns: readonly FieldId[], id: FieldId): FieldId[] {
  const field = ALL_FIELDS.find((f) => f.id === id);
  if (!field || !field.column) return columns.slice();
  if (columns.includes(id)) {
    if (field.pinned) return columns.slice();
    return columns.filter((c) => c !== id);
  }
  return orderColumns([...columns, id]);
}
