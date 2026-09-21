// devImport.test.ts — dev-only EOD import surface (STORY-031 in the UI).
//
// Covers the gating flag, the options discovery, and a real import that writes a
// SQLite DB and hot-reloads the warm universe so the imported names are served.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listImportOptions, runDevImport } from './devImport.ts';
import { createUniverseStore } from './universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { RequestError } from './handlers.ts';
import { loadConfig } from './config.ts';

const fixture = (name: string) => fileURLToPath(new URL('../tools/eod-import/fixtures/' + name, import.meta.url));

// AAPL.csv is ISO-dated with no ticker column → ticker falls back to the
// filename. An inline config override matching that shape (and no metadataFile)
// lets the test stay self-contained while still exercising the real importer.
const aaplConfig = {
  columns: { date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume' },
  dateFormat: 'iso',
  ticker: { case: 'upper' },
  delimiter: ',',
  hasHeader: true,
};

let dir: string;
let dbPath: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devimport-')); dbPath = join(dir, 'market.db'); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// DEV_TOOLS itself is parsed and pinned in config.test.ts; hardening 4.1 moved
// the flag out of this module so there is one reader of the environment.
const cfg = (extra: Partial<NodeJS.ProcessEnv> = {}) => loadConfig(extra as NodeJS.ProcessEnv);

describe('listImportOptions', () => {
  it('discovers the bundled configs and a default target DB', () => {
    const opts = listImportOptions(cfg());
    const names = opts.configs.map((c) => c.name);
    expect(names).toContain('config.example.json');
    expect(names).toContain('config.yahoo.json');
    // Metadata/tsconfig side files are not offered as configs.
    expect(names.every((n) => /^config.*\.json$/.test(n))).toBe(true);
    expect(opts.targetDb).toMatch(/dev-market\.db$/);
  });

  it('honours MARKETDATA_DB as the target', () => {
    expect(listImportOptions(cfg({ MARKETDATA_DB: '/tmp/custom.db' })).targetDb).toBe('/tmp/custom.db');
  });
});

describe('runDevImport', () => {
  it('imports a file and hot-reloads the warm universe', () => {
    const store = createUniverseStore(syntheticProvider(7));
    const result = runDevImport(
      { configName: 'config.example.json', configJson: aaplConfig, inputPath: fixture('AAPL.csv'), targetDb: dbPath },
      store,
    );
    expect(result.files).toBe(1);
    expect(result.instruments).toBe(1);
    expect(result.bars).toBeGreaterThan(0);
    expect(result.targetDb).toBe(dbPath);
    // The store now serves the imported universe (one name: AAPL), not synthetic.
    expect(result.universe).toBe(1);
    expect(store.get().map((s) => s.ticker)).toEqual(['AAPL']);
    expect(store.getInstrument('AAPL')).not.toBeNull();
  });

  it('rejects an unknown config name', () => {
    const store = createUniverseStore(syntheticProvider(7));
    expect(() => runDevImport({ configName: 'evil.json', inputPath: fixture('AAPL.csv'), targetDb: dbPath }, store))
      .toThrow(RequestError);
  });

  it('rejects a missing input path', () => {
    const store = createUniverseStore(syntheticProvider(7));
    expect(() => runDevImport({ configName: 'config.example.json', configJson: aaplConfig, inputPath: join(dir, 'nope.csv'), targetDb: dbPath }, store))
      .toThrow(/does not exist/);
  });

  it('imports uploaded CSV contents', () => {
    const store = createUniverseStore(syntheticProvider(7));
    const content = 'Date,Open,High,Low,Close,Volume\n2024-01-02,10,11,9,10.5,1000\n2024-01-03,10.5,12,10,11.8,1200\n';
    const result = runDevImport(
      { configName: 'config.example.json', configJson: aaplConfig, uploads: [{ name: 'TSLA.csv', content }], targetDb: dbPath },
      store,
    );
    expect(result.bars).toBe(2);
    expect(store.get().map((s) => s.ticker)).toEqual(['TSLA']);
  });
});
