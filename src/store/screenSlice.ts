// store/screenSlice.ts — everything the screener's list view remembers.
//
// Filter clauses, the search box, the visible tab, the columns, the sort and
// the detail dock's width, kept out of store.ts so that file stays the
// data/async layer. The slice owns its state and is spread into the store; it
// reads `matches` / `near` (which runScreen fills) through `get`, and calls
// back when a change alters one of the three floors the /signals scan is
// given, so the entries list re-scans and the fan lists do not.

import type { FanRow } from '../lib/client/marketClient.ts';
import {
  DEFAULT_COLUMNS,
  toggleColumn as toggleColumnIn,
  type ScreenTab,
  type ScreenView,
} from '../lib/screen/columns.ts';
import { DOCK_DEFAULT, clampDockWidth } from '../lib/screen/dock.ts';
import type { FieldId } from '../lib/screen/fields.ts';
import type { SortState } from '../lib/screen/sort.ts';
import {
  defaultFilters,
  filterRows,
  floorsEqual,
  removeClause as removeClauseIn,
  setClause as setClauseIn,
  signalFloorsOf,
  type Clause,
  type ScreenFilters,
} from '../lib/screen/filters.ts';

/** Worst-gap first for the fan lists, freshest entry first for the entries list. */
export const DEFAULT_SORT: Record<ScreenView, SortState> = {
  fan: { field: 'worstGap', dir: 'desc' },
  entries: { field: 'barsAgo', dir: 'asc' },
};

export interface ScreenSlice {
  search: string;
  filters: ScreenFilters;
  /** The visible list. `near` draws with the fan view's columns and sort. */
  view: ScreenTab;
  /** Width of the docked detail panel; re-clamped to the viewport at render. */
  dockWidth: number;
  /** Visible columns per view; the `near` list shares the fan view's. */
  columns: Record<ScreenView, FieldId[]>;
  /** Column sort per view. */
  sort: Record<ScreenView, SortState>;

  setView: (view: ScreenTab) => void;
  setDockWidth: (px: number) => void;
  onSearch: (v: string) => void;
  /** Add the chip, or replace the one already on that field. */
  setClause: (c: Clause) => void;
  removeClause: (field: string) => void;
  /** Replace the whole set (the chip editor's Apply, and phase 4's saved screens). */
  setFilters: (f: ScreenFilters) => void;
  resetFilters: () => void;
  setSort: (view: ScreenView, sort: SortState) => void;
  toggleColumn: (view: ScreenView, id: FieldId) => void;
  resetColumns: (view: ScreenView) => void;
  filteredMatches: () => FanRow[];
  filteredNear: () => FanRow[];
}

/** What the slice reads but does not own. */
interface ScreenSliceDeps {
  matches: FanRow[];
  near: FanRow[];
}

type SliceState = ScreenSlice & ScreenSliceDeps;
type SliceSet = (partial: Partial<ScreenSlice> | ((s: SliceState) => Partial<ScreenSlice>)) => void;
type SliceGet = () => SliceState;

export function createScreenSlice(
  set: SliceSet,
  get: SliceGet,
  /** Called when a filter change moves one of the /signals floors. */
  onFloorsChanged: () => void,
): ScreenSlice {
  const applyFilters = (next: ScreenFilters) => {
    const before = signalFloorsOf(get().filters);
    set({ filters: next });
    if (!floorsEqual(before, signalFloorsOf(next))) onFloorsChanged();
  };

  return {
    search: '',
    filters: defaultFilters(),
    view: 'fan',
    dockWidth: DOCK_DEFAULT,
    columns: { fan: [...DEFAULT_COLUMNS.fan], entries: [...DEFAULT_COLUMNS.entries] },
    sort: { fan: { ...DEFAULT_SORT.fan }, entries: { ...DEFAULT_SORT.entries } },

    setView: (view) => set({ view }),
    // The viewport is not the slice's business; the dock clamps again when it
    // renders, so a width saved on a wide screen still fits a narrow one.
    setDockWidth: (px) => set({ dockWidth: clampDockWidth(px) }),
    onSearch: (v) => set({ search: v }),
    setClause: (c) => applyFilters(setClauseIn(get().filters, c)),
    removeClause: (field) => applyFilters(removeClauseIn(get().filters, field)),
    setFilters: (f) => applyFilters(f),
    resetFilters: () => applyFilters(defaultFilters()),

    setSort: (view, sort) => set((s) => ({ sort: { ...s.sort, [view]: sort } })),
    toggleColumn: (view, id) => set((s) => ({
      columns: { ...s.columns, [view]: toggleColumnIn(s.columns[view], id) },
    })),
    resetColumns: (view) => set((s) => ({
      columns: { ...s.columns, [view]: [...DEFAULT_COLUMNS[view]] },
    })),

    filteredMatches: () => {
      const { search, filters, matches } = get();
      return filterRows(matches, search, filters);
    },
    filteredNear: () => {
      const { search, filters, near } = get();
      return filterRows(near, search, filters);
    },
  };
}
