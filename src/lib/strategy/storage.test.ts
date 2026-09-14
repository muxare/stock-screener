import { describe, it, expect } from 'vitest';
import {
  STRATEGIES_KEY,
  browserStorage,
  loadStrategies,
  memoryStorage,
  saveStrategies,
} from './storage.ts';
import { newCustomStrategy, presetById } from './presets.ts';
import type { StrategyDef } from './types.ts';

function custom(id: string, name = id): StrategyDef {
  return { ...newCustomStrategy(name), id };
}

describe('strategy storage', () => {
  it('round-trips saved strategies', () => {
    const storage = memoryStorage();
    const a = custom('custom-a', 'Breakout');
    const b = custom('custom-b', 'Bounce');
    saveStrategies(storage, [a, b]);
    const back = loadStrategies(storage);
    expect(back.map((d) => d.id)).toEqual(['custom-a', 'custom-b']);
    expect(back[0]).toEqual(a);
    expect(back[1].name).toBe('Bounce');
  });

  it('returns an empty list with no storage, no entry, or corrupt JSON', () => {
    expect(loadStrategies(null)).toEqual([]);
    expect(loadStrategies(memoryStorage())).toEqual([]);
    expect(loadStrategies(memoryStorage('{not json'))).toEqual([]);
    expect(loadStrategies(memoryStorage('{"steps":[]}'))).toEqual([]);
  });

  it('drops invalid entries but keeps the rest', () => {
    const good = custom('custom-good');
    const raw = JSON.stringify([
      { id: 'custom-bad', steps: [{ type: 'not_a_step' }] },
      good,
      { id: 'custom-empty', steps: [] },
    ]);
    const back = loadStrategies(memoryStorage(raw));
    expect(back.map((d) => d.id)).toEqual(['custom-good']);
  });

  it('ignores entries that claim a preset id or repeat one', () => {
    const shadow = { ...presetById('tag50'), name: 'Hijacked' };
    const dupe = custom('custom-dupe');
    const back = loadStrategies(memoryStorage(JSON.stringify([shadow, dupe, { ...dupe, name: 'Second' }])));
    expect(back.map((d) => d.id)).toEqual(['custom-dupe']);
    expect(back[0].name).toBe('custom-dupe');
  });

  it('never keeps the builtin flag on a saved strategy', () => {
    const back = loadStrategies(memoryStorage(JSON.stringify([{ ...custom('custom-x'), builtin: true }])));
    expect(back[0].builtin).toBeUndefined();
  });

  it('writes under the versioned key and survives a storage that throws', () => {
    const storage = memoryStorage();
    saveStrategies(storage, [custom('custom-k')]);
    expect(JSON.parse(storage.getItem(STRATEGIES_KEY) ?? '[]')).toHaveLength(1);

    const hostile = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('quota'); },
    };
    expect(() => saveStrategies(hostile, [custom('custom-k')])).not.toThrow();
    expect(loadStrategies(hostile)).toEqual([]);
    expect(saveStrategies(null, [custom('custom-k')])).toBeUndefined();
  });

  it('has no browser storage under Node (the global lacks the methods)', () => {
    expect(browserStorage()).toBeNull();
  });
});
