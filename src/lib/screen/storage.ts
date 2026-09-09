// screen/storage.ts — saved screens in localStorage.
//
// A saved screen is the filter bar, the table and the visible tab written down:
// the clauses, the sort and columns of the shape that tab draws with, and the
// entry strategy it was looking at. The store owns the list; this module only
// knows how to read and write it, and how to tell a saved copy from what is on
// screen now.
//
// Same shape as strategy/storage.ts, and for the same reasons: storage is
// injected (and may be null) so the store runs in Node tests, and every entry is
// re-parsed on load so a hand-edited or stale entry is dropped rather than
// crashing the app. What "stale" means here is specific — a screen saved before
// a field was renamed keeps a clause on a field id that no longer exists, and a
// sort key can outlive its column — so parsing drops unknown clauses, unknown
// columns and unresolvable sort keys one by one instead of losing the screen.

import { sanitizeColumns, sanitizeSort, tableViewOf, SCREEN_TABS, type ScreenTab } from './columns.ts';
import { EMA200_RISING_LOOKBACKS, type Clause, type ScreenFilters } from './filters.ts';
import { fieldOf, isFieldId, type FieldId } from './fields.ts';
import type { SortState } from './sort.ts';

export const SCREENS_KEY = 'stockScreener.screens.v1';

export const MAX_SCREEN_NAME = 60;

/** What a screen is called before it has been saved under a name. */
export const UNTITLED_SCREEN = 'Untitled screen';

/** The slice of the Web Storage API this module uses. */
export interface ScreenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The part of a saved screen that is state rather than identity. */
export interface ScreenState {
  filters: ScreenFilters;
  sort: SortState;
  columns: FieldId[];
  /** The visible tab (a row set), not the table shape. */
  view: ScreenTab;
  /** '' = the fan lists; otherwise a preset or saved strategy id. */
  signalStrategy: string;
}

export interface SavedScreen extends ScreenState {
  id: string;
  name: string;
  /** ISO timestamp of the last save. */
  savedAt: string;
  /** At most one screen carries it; that screen loads at start-up. */
  default?: boolean;
}

export function newScreenId(): string {
  return `screen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanScreenName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return s.slice(0, MAX_SCREEN_NAME);
}

// ---------------------------------------------------------------- parsing

/**
 * One clause off disk, or null when it no longer means anything: a field that
 * has left the registry or stopped being filterable, a range with no usable
 * bound left, a slope lookback the UI cannot show.
 */
export function parseClause(raw: unknown): Clause | null {
  if (raw == null || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const field = b.field;
  if (typeof field !== 'string' || !isFieldId(field) || !fieldOf(field)?.filterable) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  switch (b.kind) {
    case 'range': {
      const c: Clause = { field, kind: 'range' };
      const min = num(b.min);
      const max = num(b.max);
      if (min !== undefined) c.min = min;
      if (max !== undefined) c.max = max;
      return c;
    }
    case 'in': {
      if (field !== 'sector' || !Array.isArray(b.values)) return null;
      return { field: 'sector', kind: 'in', values: b.values.filter((v): v is string => typeof v === 'string') };
    }
    case 'bars': {
      if (field !== 'ema200Rising') return null;
      const bars = num(b.bars);
      if (bars === undefined) return null;
      if (bars !== 0 && !EMA200_RISING_LOOKBACKS.includes(bars as (typeof EMA200_RISING_LOOKBACKS)[number])) return null;
      return { field: 'ema200Rising', kind: 'bars', bars };
    }
    default:
      return null;
  }
}

/** A filter set off disk: bad clauses are dropped, and one field keeps one clause. */
export function parseScreenFilters(raw: unknown): ScreenFilters {
  const list = raw && typeof raw === 'object' ? (raw as { clauses?: unknown }).clauses : null;
  if (!Array.isArray(list)) return { clauses: [] };
  const clauses: Clause[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const c = parseClause(item);
    if (!c || seen.has(c.field)) continue;
    seen.add(c.field);
    clauses.push(c);
  }
  return { clauses };
}

function parseTab(raw: unknown): ScreenTab {
  return SCREEN_TABS.includes(raw as ScreenTab) ? (raw as ScreenTab) : 'fan';
}

/** One saved screen off disk, or null when it has no identity left to load by. */
export function parseSavedScreen(raw: unknown): SavedScreen | null {
  if (raw == null || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const id = typeof b.id === 'string' ? b.id.trim() : '';
  const name = cleanScreenName(b.name);
  if (!id || !name) return null;
  const view = parseTab(b.view);
  const screen: SavedScreen = {
    id,
    name,
    savedAt: typeof b.savedAt === 'string' ? b.savedAt : new Date(0).toISOString(),
    filters: parseScreenFilters(b.filters),
    sort: sanitizeSort(b.sort, tableViewOf(view)),
    columns: sanitizeColumns(b.columns, tableViewOf(view)),
    view,
    signalStrategy: typeof b.signalStrategy === 'string' ? b.signalStrategy : '',
  };
  if (b.default === true) screen.default = true;
  return screen;
}

// ---------------------------------------------------------------- the list

/** Saved screens, newest last. Invalid entries and duplicate ids are dropped. */
export function loadScreens(storage: ScreenStorage | null): SavedScreen[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(SCREENS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SavedScreen[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const screen = parseSavedScreen(item);
    if (!screen || seen.has(screen.id)) continue;
    seen.add(screen.id);
    out.push(screen);
  }
  return onlyOneDefault(out);
}

export function saveScreens(storage: ScreenStorage | null, screens: readonly SavedScreen[]): void {
  if (!storage) return;
  try {
    storage.setItem(SCREENS_KEY, JSON.stringify(screens));
  } catch {
    // Quota or a private-mode denial: the list stays in memory for this session.
  }
}

/** The one screen that loads at start-up, or none. */
export function defaultScreen(screens: readonly SavedScreen[]): SavedScreen | undefined {
  return screens.find((s) => s.default);
}

function withoutDefault(screen: SavedScreen): SavedScreen {
  const next = { ...screen };
  delete next.default;
  return next;
}

/** Exactly one default survives — the first one declared. */
export function onlyOneDefault(screens: readonly SavedScreen[]): SavedScreen[] {
  let taken = false;
  return screens.map((s) => {
    if (!s.default) return s;
    if (taken) return withoutDefault(s);
    taken = true;
    return s;
  });
}

/** `id` becomes the default (null clears it), and nothing else is. */
export function withDefault(screens: readonly SavedScreen[], id: string | null): SavedScreen[] {
  return screens.map((s) => {
    if (s.id === id) return { ...s, default: true };
    return s.default ? withoutDefault(s) : s;
  });
}

// ---------------------------------------------------------------- dirty check

function clauseEqual(a: Clause, b: Clause): boolean {
  if (a.field !== b.field || a.kind !== b.kind) return false;
  if (a.kind === 'range' && b.kind === 'range') return a.min === b.min && a.max === b.max;
  if (a.kind === 'in' && b.kind === 'in') {
    return a.values.length === b.values.length && a.values.every((v, i) => v === b.values[i]);
  }
  if (a.kind === 'bars' && b.kind === 'bars') return a.bars === b.bars;
  return false;
}

/**
 * Is what is on screen still the screen that was saved? Compared field by field
 * rather than by serialising: clause objects differ in key order depending on
 * which bound was typed first, and `Save` lighting up for that would be a lie.
 * Clause *order* is part of the screen — it is the order the chips sit in.
 */
export function screenStateEqual(a: ScreenState, b: ScreenState): boolean {
  if (a.view !== b.view || a.signalStrategy !== b.signalStrategy) return false;
  if (a.sort.field !== b.sort.field || a.sort.dir !== b.sort.dir) return false;
  if (a.columns.length !== b.columns.length) return false;
  if (!a.columns.every((c, i) => c === b.columns[i])) return false;
  if (a.filters.clauses.length !== b.filters.clauses.length) return false;
  return a.filters.clauses.every((c, i) => clauseEqual(c, b.filters.clauses[i]));
}
