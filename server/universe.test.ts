// universe.test.ts — production guard on dev/test market-data adapters (STORY-033).
//
// Both adapters behind the MarketDataProvider port (SAD#5.10) are dev/test only:
// the synthetic generator (SAD#8.7) and the SQLite reader (STORY-032). The real
// production adapter is deferred to ADR-008 (SAD#8.8). So in a production
// environment providerFromEnv() must FAIL FAST rather than serve dev/test data,
// while non-production behaviour is unchanged (synthetic by default, SQLite when
// MARKETDATA_DB is set).
//
// The SQLite fixture is built with the STORY-031 importer's writer so the
// dev/test-allowed path is exercised against a real "produced by STORY-031" DB.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EodDatabase } from '../tools/eod-import/db.ts';
import { providerFromEnv } from './universe.ts';

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
let pointer: string; // temp dev-active-db pointer so tests never touch the repo's
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'universe-'));
  aaplDb = join(dir, 'aapl.db');
  pointer = join(dir, '.dev-active-db');
  makeDb(aaplDb, ['AAPL']);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const env = (extra: Partial<NodeJS.ProcessEnv> = {}) => extra as NodeJS.ProcessEnv;

describe('providerFromEnv production guard', () => {
  it('refuses the synthetic dev/test adapter in production (no MARKETDATA_DB)', () => {
    expect(() => providerFromEnv(env({ NODE_ENV: 'production' }), pointer)).toThrow(/production/);
  });

  it('refuses the SQLite dev/test adapter in production (MARKETDATA_DB set)', () => {
    // Throws on the production guard, BEFORE opening the DB — so a valid DB path
    // is still refused (it is the production environment, not the file, at fault).
    expect(() =>
      providerFromEnv(env({ NODE_ENV: 'production', MARKETDATA_DB: aaplDb }), pointer),
    ).toThrow(/production/);
  });
});

describe('providerFromEnv non-production (dev/test) behaviour', () => {
  it('serves synthetic by default when no MARKETDATA_DB is set', () => {
    const provider = providerFromEnv(env({ NODE_ENV: 'development' }), pointer);
    const universe = provider.getUniverse();
    // The synthetic generator yields its multi-name demo universe.
    expect(universe.length).toBeGreaterThan(1);
    expect(universe.some((i) => i.ticker === 'AAPL')).toBe(true);
  });

  it('serves SQLite when MARKETDATA_DB points at a STORY-031 DB', () => {
    const provider = providerFromEnv(env({ NODE_ENV: 'test', MARKETDATA_DB: aaplDb }), pointer);
    const universe = provider.getUniverse();
    expect(universe.map((i) => i.ticker)).toEqual(['AAPL']);
  });

  it('treats an unset NODE_ENV as non-production (synthetic default)', () => {
    const provider = providerFromEnv(env(), pointer);
    expect(provider.getUniverse().length).toBeGreaterThan(1);
  });
});
