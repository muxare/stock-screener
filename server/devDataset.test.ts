// devDataset.test.ts — dev-only DB-selector surface (STORY-035 in the UI).
//
// Covers discovery of selectable DBs (with the active marker + instrument count
// + invalid-file flagging) and runtime activation: switching onto a SQLite DB,
// switching back to synthetic, and the guards against unknown/invalid paths.
//
// Fixture DBs are built with the STORY-031 importer's writer (EodDatabase) so the
// selector is exercised against real "produced by STORY-031" databases.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EodDatabase } from '../tools/eod-import/db.ts';
import { listDatabases, activateDatabase } from './devDataset.ts';
import { createUniverseStore } from './universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { sqliteProvider } from '../src/lib/data/sqlite.ts';
import { RequestError } from './handlers.ts';
import { loadConfig } from './config.ts';

// Build a STORY-031 DB with `tickers` single-bar instruments at `path`.
function makeDb(path: string, tickers: string[]): void {
  const db = new EodDatabase(path);
  db.write(
    tickers.map((t) => ({ ticker: t, name: `${t} Inc.`, sector: 'Technology' })),
    tickers.map((t) => ({ ticker: t, date: '2024-01-01', o: 1, h: 2, l: 0.5, c: 1.5, v: 1000 })),
  );
  db.close();
}

let dir: string;
let aaplDb: string;
let twoDb: string;
let pointer: string; // temp dev-active-db pointer so tests never touch the repo's
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devdataset-'));
  aaplDb = join(dir, 'aapl.db');
  twoDb = join(dir, 'two.db');
  pointer = join(dir, '.dev-active-db');
  makeDb(aaplDb, ['AAPL']);
  makeDb(twoDb, ['MSFT', 'NVDA']);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const cfg = (extra: Partial<NodeJS.ProcessEnv> = {}) =>
  loadConfig({ MARKETDATA_DIR: dir, ...extra } as NodeJS.ProcessEnv);

describe('listDatabases', () => {
  it('discovers .db files in the scan dir with instrument counts', () => {
    const store = createUniverseStore(syntheticProvider(7));
    const list = listDatabases(store, cfg());
    expect(list.scanDir).toBe(resolve(dir));
    const byName = Object.fromEntries(list.databases.map((d) => [d.name, d]));
    expect(byName['aapl.db'].instruments).toBe(1);
    expect(byName['two.db'].instruments).toBe(2);
    expect(byName['aapl.db'].valid).toBe(true);
    expect(byName['two.db'].sizeBytes).toBeGreaterThan(0);
  });

  it('reports synthetic as active and marks no DB active when no DB is loaded', () => {
    const store = createUniverseStore(syntheticProvider(7), { kind: 'synthetic' });
    const list = listDatabases(store, cfg());
    expect(list.activeKind).toBe('synthetic');
    expect(list.activePath).toBeNull();
    expect(list.databases.every((d) => !d.active)).toBe(true);
  });

  it('marks the active DB once one is activated', () => {
    const store = createUniverseStore(syntheticProvider(7), { kind: 'synthetic' });
    activateDatabase({ path: aaplDb }, store, cfg(), pointer);
    const list = listDatabases(store, cfg());
    expect(list.activeKind).toBe('sqlite');
    expect(list.activePath).toBe(resolve(aaplDb));
    expect(list.databases.find((d) => d.name === 'aapl.db')!.active).toBe(true);
    expect(list.databases.find((d) => d.name === 'two.db')!.active).toBe(false);
  });

  it('flags a non-STORY-031 .db file as invalid rather than hiding it', () => {
    const wrong = join(dir, 'wrong.db');
    const bad = new DatabaseSync(wrong);
    bad.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY);');
    bad.close();
    const store = createUniverseStore(syntheticProvider(7));
    const entry = listDatabases(store, cfg()).databases.find((d) => d.name === 'wrong.db')!;
    expect(entry.valid).toBe(false);
    expect(entry.instruments).toBeNull();
  });

  it('ignores -wal/-shm sidecar files (only *.db)', () => {
    writeFileSync(join(dir, 'aapl.db-wal'), 'x');
    writeFileSync(join(dir, 'aapl.db-shm'), 'x');
    const store = createUniverseStore(syntheticProvider(7));
    const names = listDatabases(store, cfg()).databases.map((d) => d.name);
    expect(names).not.toContain('aapl.db-wal');
    expect(names).not.toContain('aapl.db-shm');
  });
});

describe('activateDatabase', () => {
  it('switches the warm universe onto the chosen SQLite DB', () => {
    const store = createUniverseStore(syntheticProvider(7), { kind: 'synthetic' });
    const result = activateDatabase({ path: twoDb }, store, cfg(), pointer);
    expect(result.activeKind).toBe('sqlite');
    expect(result.activePath).toBe(resolve(twoDb));
    expect(result.universe).toBe(2);
    expect(store.get().map((s) => s.ticker)).toEqual(['MSFT', 'NVDA']);
    expect(store.source()).toEqual({ kind: 'sqlite', path: resolve(twoDb) });
  });

  it('switches back to the synthetic generator', () => {
    const store = createUniverseStore(sqliteProvider(aaplDb), { kind: 'sqlite', path: resolve(aaplDb) });
    expect(store.get().map((s) => s.ticker)).toEqual(['AAPL']);
    const result = activateDatabase({ synthetic: true }, store, cfg(), pointer);
    expect(result.activeKind).toBe('synthetic');
    expect(result.activePath).toBeNull();
    expect(result.universe).toBeGreaterThan(2); // the synthetic fixture, not AAPL
    expect(store.source()).toEqual({ kind: 'synthetic' });
  });

  it('rejects a path outside the discovered set (no arbitrary file access)', () => {
    const store = createUniverseStore(syntheticProvider(7));
    const outside = join(tmpdir(), 'somewhere-else.db');
    expect(() => activateDatabase({ path: outside }, store, cfg())).toThrow(RequestError);
    expect(() => activateDatabase({ path: outside }, store, cfg())).toThrow(/unknown database/);
  });

  it('rejects an invalid (non-STORY-031) DB with a clear error', () => {
    const wrong = join(dir, 'wrong.db');
    const bad = new DatabaseSync(wrong);
    bad.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY);');
    bad.close();
    const store = createUniverseStore(syntheticProvider(7));
    expect(() => activateDatabase({ path: wrong }, store, cfg())).toThrow(/could not open database/);
  });

  it('rejects a request with neither a path nor synthetic', () => {
    const store = createUniverseStore(syntheticProvider(7));
    expect(() => activateDatabase({}, store, cfg())).toThrow(/provide a database path/);
  });
});
