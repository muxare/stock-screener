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

// The Yahoo MVP boot default (ADR-008 interim / SAD#8.8): absent an explicit
// MARKETDATA_DB or dev pointer, the dev service boots on the Yahoo build when it
// exists — so manual testing runs on real adjusted bars — but only under
// DEV_TOOLS, and it degrades to synthetic when the DB is absent (no fail-fast).
describe('Yahoo MVP default DB (ADR-008 interim)', () => {
  it('serves the Yahoo DB by default when present and DEV_TOOLS is on', () => {
    const yahooDb = join(dir, 'yahoo-market.db');
    makeDb(yahooDb, ['YHOO']);
    const provider = providerFromEnv(env({ NODE_ENV: 'development', DEV_TOOLS: '1' }), pointer, yahooDb);
    expect(provider.getUniverse().map((i) => i.ticker)).toEqual(['YHOO']);
  });

  it('ignores the Yahoo DB when DEV_TOOLS is off (stays synthetic)', () => {
    const yahooDb = join(dir, 'yahoo-market.db');
    makeDb(yahooDb, ['YHOO']);
    const provider = providerFromEnv(env({ NODE_ENV: 'development' }), pointer, yahooDb);
    const universe = provider.getUniverse();
    expect(universe.length).toBeGreaterThan(1); // synthetic multi-name demo
    expect(universe.some((i) => i.ticker === 'YHOO')).toBe(false);
  });

  it('falls back to synthetic when DEV_TOOLS is on but the Yahoo DB is absent', () => {
    const missing = join(dir, 'no-yahoo.db');
    const provider = providerFromEnv(env({ NODE_ENV: 'development', DEV_TOOLS: '1' }), pointer, missing);
    expect(provider.getUniverse().length).toBeGreaterThan(1);
  });

  it('honours an explicit MARKETDATA_DB over the Yahoo default', () => {
    const yahooDb = join(dir, 'yahoo-market.db');
    makeDb(yahooDb, ['YHOO']);
    const provider = providerFromEnv(
      env({ NODE_ENV: 'test', DEV_TOOLS: '1', MARKETDATA_DB: aaplDb }),
      pointer,
      yahooDb,
    );
    expect(provider.getUniverse().map((i) => i.ticker)).toEqual(['AAPL']);
  });

  it('refuses the Yahoo default in production (production guard wins)', () => {
    const yahooDb = join(dir, 'yahoo-market.db');
    makeDb(yahooDb, ['YHOO']);
    expect(() =>
      providerFromEnv(env({ NODE_ENV: 'production', DEV_TOOLS: '1' }), pointer, yahooDb),
    ).toThrow(/production/);
  });
});
