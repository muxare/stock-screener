// strategy/storage.ts — saved custom strategies in localStorage.
//
// The store owns the list; this module only knows how to read and write it.
// Storage is injected (and may be null) so the store can run in Node tests
// without a Web Storage shim, and every entry is re-parsed on load: a hand-
// edited or stale entry is dropped rather than crashing the app.

import { parseStrategyDef } from './parse.ts';
import { isPresetId } from './presets.ts';
import type { StrategyDef } from './types.ts';

export const STRATEGIES_KEY = 'stockScreener.strategies.v1';

/** The slice of the Web Storage API this module uses. */
export interface StrategyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The browser's localStorage, or null when there is none (Node, or a browser
 * that denies storage access). Node exposes a `localStorage` global without the
 * methods, so the methods are what is probed.
 */
export function browserStorage(): StrategyStorage | null {
  try {
    const ls = typeof localStorage === 'undefined' ? null : (localStorage as unknown as Partial<StrategyStorage>);
    if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') return null;
    return ls as StrategyStorage;
  } catch {
    return null;
  }
}

/**
 * An in-memory storage, for tests and for a browser that refuses to persist.
 * `key` seeds a different key space — saved screens share one storage object
 * with saved strategies (see screen/storage.ts).
 */
export function memoryStorage(initial?: string, key: string = STRATEGIES_KEY): StrategyStorage {
  const map = new Map<string, string>();
  if (initial != null) map.set(key, initial);
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

/** Saved strategies, newest last. Invalid entries, duplicates and preset ids are dropped. */
export function loadStrategies(storage: StrategyStorage | null): StrategyDef[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(STRATEGIES_KEY);
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
  const out: StrategyDef[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    let def: StrategyDef;
    try {
      def = parseStrategyDef(item);
    } catch {
      continue;
    }
    // A saved entry may never shadow a built-in id, and never claim to be one.
    if (isPresetId(def.id) || seen.has(def.id)) continue;
    delete def.builtin;
    seen.add(def.id);
    out.push(def);
  }
  return out;
}

export function saveStrategies(storage: StrategyStorage | null, defs: StrategyDef[]): void {
  if (!storage) return;
  try {
    storage.setItem(STRATEGIES_KEY, JSON.stringify(defs));
  } catch {
    // Quota or a private-mode denial: the list stays in memory for this session.
  }
}
