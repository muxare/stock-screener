// screen/columns.ts — which columns each view shows, and in what order.
//
// Pure defaults plus the one operation the store needs (toggle a column).
// Kept out of store.ts so the state there stays a value and a setter.

import { ALL_FIELDS, isFieldId, type FieldId } from './fields.ts';
import type { SortKey, SortState } from './sort.ts';

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

/** Worst-gap first for the fan lists, freshest entry first for the entries list. */
export const DEFAULT_SORT: Record<ScreenView, SortState> = {
  fan: { field: 'worstGap', dir: 'desc' },
  entries: { field: 'barsAgo', dir: 'asc' },
};

/**
 * Sort keys a table adds beyond the registry — the entries list's own trade
 * columns (see `SIGNAL_COLUMNS` in components/ScreenView.tsx). They are listed
 * here so a saved sort key can be checked without reaching into a component;
 * a key that is in neither list no longer resolves and falls back.
 */
export const EXTRA_SORT_KEYS: Record<ScreenView, readonly SortKey[]> = {
  fan: [],
  entries: ['entryPrice', 'stopPrice', 'riskPerShare', 'targetWindow', 'barsAgo'],
};

/** Does `key` still name something this view can sort by? */
export function sortKeyResolves(key: string, view: ScreenView): boolean {
  return isFieldId(key) || EXTRA_SORT_KEYS[view].includes(key);
}

/**
 * A saved (so untrusted) sort for `view`: a key that no longer resolves — a
 * field that left the registry, or an entries key on the fan table — falls
 * back to the view's default rather than sorting by nothing.
 */
export function sanitizeSort(raw: unknown, view: ScreenView): SortState {
  const fallback = { ...DEFAULT_SORT[view] };
  if (raw == null || typeof raw !== 'object') return fallback;
  const { field, dir } = raw as { field?: unknown; dir?: unknown };
  if (typeof field !== 'string' || !sortKeyResolves(field, view)) return fallback;
  return { field, dir: dir === 'asc' ? 'asc' : 'desc' };
}

/**
 * A saved (so untrusted) column list for `view`: unknown or filter-only ids are
 * dropped, duplicates collapse, the pinned columns are put back, and the result
 * is in declaration order like every other column list. A list with nothing
 * recognisable in it falls back to the view's defaults — but a list that is
 * only the pinned column is a real choice (the chooser can hide the rest) and
 * is kept as it is.
 */
export function sanitizeColumns(raw: unknown, view: ScreenView): FieldId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_COLUMNS[view]];
  const kept = new Set<FieldId>();
  for (const id of raw) {
    if (typeof id !== 'string' || !isFieldId(id)) continue;
    if (!ALL_FIELDS.find((f) => f.id === id)?.column) continue;
    kept.add(id);
  }
  if (kept.size === 0) return [...DEFAULT_COLUMNS[view]];
  for (const f of ALL_FIELDS) if (f.pinned && f.column) kept.add(f.id);
  return orderColumns([...kept]);
}

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
