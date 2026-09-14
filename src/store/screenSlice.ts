// store/screenSlice.ts — everything the screener's list view remembers.
//
// Filter clauses, the search box, the visible tab, the columns, the sort, the
// detail dock's width and the saved screens, kept out of store.ts so that file
// stays the data/async layer. The slice owns its state and is spread into the
// store; it reads `matches` / `near` (which runScreen fills) through `get`, and
// calls back when a change alters one of the three floors the /signals scan is
// given, so the entries list re-scans and the fan lists do not.
//
// A saved screen is the one piece that reaches back out: it carries an entry
// strategy, which store.ts owns because picking one moves the tab and starts a
// scan. So `signalStrategy` / `setSignalStrategy` are declared deps here, and
// loading a screen goes through the setter rather than around it.

import type { FanRow } from '../lib/client/marketClient.ts';
import type { StrategyDef } from '../lib/strategy/types.ts';
import { resolveStrategy } from '../lib/strategy/presets.ts';
import {
  DEFAULT_COLUMNS,
  DEFAULT_SORT,
  tableViewOf,
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
import {
  cleanScreenName,
  defaultScreen,
  loadScreens,
  newScreenId,
  saveScreens,
  screenStateEqual,
  withDefault,
  UNTITLED_SCREEN,
  type SavedScreen,
  type ScreenState,
  type ScreenStorage,
} from '../lib/screen/storage.ts';

export { DEFAULT_SORT };

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
  /** Saved screens, newest last. */
  screens: SavedScreen[];
  /** The screen the current state was loaded from, or null for an unsaved one. */
  activeScreenId: string | null;

  setView: (view: ScreenTab) => void;
  setDockWidth: (px: number) => void;
  onSearch: (v: string) => void;
  /** Add the chip, or replace the one already on that field. */
  setClause: (c: Clause) => void;
  removeClause: (field: string) => void;
  /** Replace the whole set (the chip editor's Apply, and a loaded screen). */
  setFilters: (f: ScreenFilters) => void;
  resetFilters: () => void;
  setSort: (view: ScreenView, sort: SortState) => void;
  toggleColumn: (view: ScreenView, id: FieldId) => void;
  resetColumns: (view: ScreenView) => void;
  filteredMatches: () => FanRow[];
  filteredNear: () => FanRow[];

  /** The filters, sort, columns, tab and strategy a save would write down. */
  screenState: () => ScreenState;
  /** The screen currently loaded, or undefined when none is. */
  activeScreen: () => SavedScreen | undefined;
  /** Does the current state differ from the screen it was loaded from? */
  screenDirty: () => boolean;
  /** Back to the out-of-the-box screen, loaded from nothing. */
  newScreen: () => void;
  /** Overwrite the loaded screen; a no-op when none is loaded. */
  saveScreen: () => void;
  /** Save the current state under a new name and make it the loaded screen. */
  saveScreenAs: (name: string) => void;
  loadScreen: (id: string) => void;
  renameScreen: (id: string, name: string) => void;
  deleteScreen: (id: string) => void;
  /** Make `id` the screen that loads at start-up; null clears the flag. */
  setDefaultScreen: (id: string | null) => void;
  /** Load the default screen, if there is one. Called once, at start-up. */
  applyDefaultScreen: () => void;
}

/** What the slice reads but does not own. */
interface ScreenSliceDeps {
  matches: FanRow[];
  near: FanRow[];
  strategies: StrategyDef[];
  signalStrategy: string;
  setSignalStrategy: (strategy: string) => void;
}

type SliceState = ScreenSlice & ScreenSliceDeps;
type SliceSet = (partial: Partial<ScreenSlice> | ((s: SliceState) => Partial<ScreenSlice>)) => void;
type SliceGet = () => SliceState;

export function createScreenSlice(
  set: SliceSet,
  get: SliceGet,
  /** Called when a filter change moves one of the /signals floors. */
  onFloorsChanged: () => void,
  storage: ScreenStorage | null = null,
): ScreenSlice {
  const applyFilters = (next: ScreenFilters) => {
    const before = signalFloorsOf(get().filters);
    set({ filters: next });
    if (!floorsEqual(before, signalFloorsOf(next))) onFloorsChanged();
  };

  const persist = (screens: SavedScreen[]) => {
    saveScreens(storage, screens);
    set({ screens });
  };

  return {
    search: '',
    filters: defaultFilters(),
    view: 'fan',
    dockWidth: DOCK_DEFAULT,
    columns: { fan: [...DEFAULT_COLUMNS.fan], entries: [...DEFAULT_COLUMNS.entries] },
    sort: { fan: { ...DEFAULT_SORT.fan }, entries: { ...DEFAULT_SORT.entries } },
    screens: loadScreens(storage),
    activeScreenId: null,

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

    // ------------------------------------------------------------ saved screens

    screenState: () => {
      const { filters, sort, columns, view, signalStrategy } = get();
      const shape = tableViewOf(view);
      return {
        filters: { clauses: filters.clauses.map((c) => ({ ...c })) },
        sort: { ...sort[shape] },
        columns: [...columns[shape]],
        view,
        signalStrategy,
      };
    },
    activeScreen: () => {
      const { screens, activeScreenId } = get();
      return screens.find((s) => s.id === activeScreenId);
    },
    screenDirty: () => {
      const saved = get().activeScreen();
      // Nothing loaded: the screen is a draft, not a modified copy of anything.
      return saved ? !screenStateEqual(saved, get().screenState()) : false;
    },

    newScreen: () => {
      set({
        filters: defaultFilters(),
        columns: { fan: [...DEFAULT_COLUMNS.fan], entries: [...DEFAULT_COLUMNS.entries] },
        sort: { fan: { ...DEFAULT_SORT.fan }, entries: { ...DEFAULT_SORT.entries } },
        view: 'fan',
        activeScreenId: null,
      });
      // Everything the slice owns is back to its default; the strategy is not
      // the slice's, so it goes through the setter (which also clears the scan).
      get().setSignalStrategy('');
    },

    saveScreen: () => {
      const { screens, activeScreenId } = get();
      if (!activeScreenId) return;
      const state = get().screenState();
      persist(screens.map((s) => (
        s.id === activeScreenId ? { ...s, ...state, savedAt: new Date().toISOString() } : s
      )));
    },
    saveScreenAs: (name) => {
      const screen: SavedScreen = {
        id: newScreenId(),
        name: cleanScreenName(name) || UNTITLED_SCREEN,
        savedAt: new Date().toISOString(),
        ...get().screenState(),
      };
      persist([...get().screens, screen]);
      set({ activeScreenId: screen.id });
    },

    loadScreen: (id) => {
      const saved = get().screens.find((s) => s.id === id);
      if (!saved) return;
      const shape = tableViewOf(saved.view);
      // The filters land first so the scan the strategy setter kicks off already
      // carries the saved floors — which is also why this does not go through
      // `setFilters`: its floors callback would fire a scan on the old strategy.
      set((s) => ({
        filters: { clauses: saved.filters.clauses.map((c) => ({ ...c })) },
        columns: { ...s.columns, [shape]: [...saved.columns] },
        sort: { ...s.sort, [shape]: { ...saved.sort } },
        activeScreenId: id,
      }));
      // A screen can outlive the strategy it was saved with; falling back to the
      // fan lists beats a scan that can only fail.
      const strategy = saved.signalStrategy && resolveStrategy(saved.signalStrategy, get().strategies)
        ? saved.signalStrategy
        : '';
      get().setSignalStrategy(strategy);
      // Last: the strategy setter moves the tab, so restoring the view after it
      // is what makes a screen saved on the `near` tab come back on `near`.
      set({ view: saved.view });
    },

    renameScreen: (id, name) => {
      const clean = cleanScreenName(name);
      if (!clean) return;
      persist(get().screens.map((s) => (s.id === id ? { ...s, name: clean } : s)));
    },
    deleteScreen: (id) => {
      const screens = get().screens;
      const next = screens.filter((s) => s.id !== id);
      if (next.length === screens.length) return;
      persist(next);
      // The state stays on screen; it is just no longer a copy of anything.
      if (get().activeScreenId === id) set({ activeScreenId: null });
    },
    setDefaultScreen: (id) => persist(withDefault(get().screens, id)),

    applyDefaultScreen: () => {
      const screen = defaultScreen(get().screens);
      if (screen) get().loadScreen(screen.id);
    },
  };
}
