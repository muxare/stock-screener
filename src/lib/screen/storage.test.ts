import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../strategy/storage';
import { DEFAULT_COLUMNS, DEFAULT_SORT } from './columns';
import { defaultFilters } from './filters';
import {
  SCREENS_KEY,
  loadScreens,
  newScreenId,
  onlyOneDefault,
  parseSavedScreen,
  parseScreenFilters,
  saveScreens,
  screenStateEqual,
  withDefault,
  type SavedScreen,
} from './storage';

function screen(over: Partial<SavedScreen> = {}): SavedScreen {
  return {
    id: 's1',
    name: 'Ema fan technical',
    savedAt: '2026-09-08T10:00:00.000Z',
    filters: { clauses: [{ field: 'price', kind: 'range', min: 20, max: 100 }] },
    sort: { field: 'rsi14', dir: 'asc' },
    columns: [...DEFAULT_COLUMNS.fan],
    view: 'fan',
    signalStrategy: '',
    ...over,
  };
}

const seeded = (screens: unknown) => memoryStorage(JSON.stringify(screens), SCREENS_KEY);

describe('saved screens round-trip', () => {
  it('writes and reads back the same screens', () => {
    const storage = memoryStorage();
    const screens = [screen(), screen({ id: 's2', name: 'Oversold', view: 'near' })];
    saveScreens(storage, screens);
    expect(loadScreens(storage)).toEqual(screens);
  });

  it('is empty with no storage, no entry, corrupt JSON or a non-array', () => {
    expect(loadScreens(null)).toEqual([]);
    expect(loadScreens(memoryStorage())).toEqual([]);
    expect(loadScreens(memoryStorage('{not json', SCREENS_KEY))).toEqual([]);
    expect(loadScreens(seeded({ id: 's1' }))).toEqual([]);
  });

  it('drops an entry with no identity and de-duplicates ids', () => {
    const screens = loadScreens(seeded([
      screen(),
      { ...screen(), id: '' },
      { ...screen(), name: '   ' },
      { ...screen(), name: 'A second copy of s1' },
      'nonsense',
    ]));
    expect(screens.map((s) => s.name)).toEqual(['Ema fan technical']);
  });

  it('keeps a screen usable when parts of it have gone stale', () => {
    const [s] = loadScreens(seeded([{
      ...screen(),
      filters: { clauses: [
        { field: 'price', kind: 'range', min: 20 },
        { field: 'unicornCount', kind: 'range', min: 3 },   // field left the registry
        { field: 'ticker', kind: 'range', min: 1 },          // never filterable
        { field: 'price', kind: 'range', max: 5 },           // one clause per field
        { field: 'ema200Rising', kind: 'bars', bars: 7 },    // not a lookback the UI offers
      ] },
      columns: ['rsi14', 'rsi14', 'unicornCount', 'ema200Rising'],
      sort: { field: 'unicornCount', dir: 'asc' },
    }]));
    expect(s.filters.clauses).toEqual([{ field: 'price', kind: 'range', min: 20 }]);
    // Unknown and filter-only ids go; the pinned ticker column comes back.
    expect(s.columns).toEqual(['ticker', 'rsi14']);
    // A sort key that no longer resolves falls back to the view's default.
    expect(s.sort).toEqual(DEFAULT_SORT.fan);
  });

  it('keeps an entries screen\'s own sort key, which is not a field id', () => {
    const [s] = loadScreens(seeded([screen({ view: 'entries', sort: { field: 'barsAgo', dir: 'asc' } })]));
    expect(s.sort).toEqual({ field: 'barsAgo', dir: 'asc' });
    // …but that key means nothing to the fan table.
    const [fan] = loadScreens(seeded([screen({ view: 'fan', sort: { field: 'barsAgo', dir: 'asc' } })]));
    expect(fan.sort).toEqual(DEFAULT_SORT.fan);
  });

  it('falls back to the fan tab and empty filters for junk', () => {
    const [s] = loadScreens(seeded([{ id: 'x', name: 'Junk', view: 'nowhere', filters: 7, signalStrategy: 3 }]));
    expect(s.view).toBe('fan');
    expect(s.filters).toEqual({ clauses: [] });
    expect(s.signalStrategy).toBe('');
    expect(s.columns).toEqual(DEFAULT_COLUMNS.fan);
  });

  it('parses a sector clause down to its strings', () => {
    expect(parseScreenFilters({ clauses: [{ field: 'sector', kind: 'in', values: ['Tech', 4, null] }] }))
      .toEqual({ clauses: [{ field: 'sector', kind: 'in', values: ['Tech'] }] });
    expect(parseScreenFilters({ clauses: [{ field: 'price', kind: 'in', values: ['Tech'] }] }))
      .toEqual({ clauses: [] });
  });

  it('rejects a screen that is not an object at all', () => {
    expect(parseSavedScreen(null)).toBeNull();
    expect(parseSavedScreen(42)).toBeNull();
  });

  it('gives every new screen its own id', () => {
    expect(newScreenId()).not.toBe(newScreenId());
  });
});

describe('the default screen', () => {
  it('keeps only the first flag, on load and when one is set', () => {
    const many = [screen({ id: 'a', default: true }), screen({ id: 'b', default: true })];
    expect(onlyOneDefault(many).map((s) => s.default)).toEqual([true, undefined]);
    expect(loadScreens(seeded(many)).map((s) => s.default)).toEqual([true, undefined]);
  });

  it('moves the flag and clears it', () => {
    const many = [screen({ id: 'a', default: true }), screen({ id: 'b' })];
    expect(withDefault(many, 'b').map((s) => s.default)).toEqual([undefined, true]);
    expect(withDefault(many, null).every((s) => s.default === undefined)).toBe(true);
  });
});

describe('screenStateEqual — what lights Save up', () => {
  const base = screen();

  it('is true for an identical copy, whatever the key order', () => {
    const copy = screen({ filters: { clauses: [{ kind: 'range', max: 100, min: 20, field: 'price' }] } });
    expect(screenStateEqual(base, copy)).toBe(true);
  });

  it('notices a bound, a clause, the clause order, the sort, a column and the tab', () => {
    expect(screenStateEqual(base, screen({ filters: { clauses: [{ field: 'price', kind: 'range', min: 21, max: 100 }] } }))).toBe(false);
    expect(screenStateEqual(base, screen({ filters: defaultFilters() }))).toBe(false);
    const two = screen({ filters: { clauses: [
      { field: 'price', kind: 'range', min: 20, max: 100 },
      { field: 'rsi14', kind: 'range', min: 50 },
    ] } });
    const swapped = screen({ filters: { clauses: [...two.filters.clauses].reverse() } });
    expect(screenStateEqual(two, swapped)).toBe(false);
    expect(screenStateEqual(base, screen({ sort: { field: 'rsi14', dir: 'desc' } }))).toBe(false);
    expect(screenStateEqual(base, screen({ columns: DEFAULT_COLUMNS.fan.slice(1) }))).toBe(false);
    expect(screenStateEqual(base, screen({ view: 'near' }))).toBe(false);
    expect(screenStateEqual(base, screen({ signalStrategy: 'tag50' }))).toBe(false);
  });

  it('ignores the name and the save time', () => {
    expect(screenStateEqual(base, screen({ name: 'Renamed', savedAt: 'later', default: true }))).toBe(true);
  });

  it('compares a sector list by its members', () => {
    const tech = screen({ filters: { clauses: [{ field: 'sector', kind: 'in', values: ['Tech'] }] } });
    const both = screen({ filters: { clauses: [{ field: 'sector', kind: 'in', values: ['Tech', 'Energy'] }] } });
    expect(screenStateEqual(tech, screen({ filters: { clauses: [{ field: 'sector', kind: 'in', values: ['Tech'] }] } }))).toBe(true);
    expect(screenStateEqual(tech, both)).toBe(false);
  });
});
