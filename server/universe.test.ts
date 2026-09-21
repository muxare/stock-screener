// universe.test.ts — which adapter a configuration selects (STORY-033).
//
// Both adapters behind the MarketDataProvider port (SAD#5.10) are dev/test only:
// the synthetic generator (SAD#8.7) and the SQLite reader (STORY-032). The real
// production adapter is deferred to ADR-008 (SAD#8.8). The guard that refuses a
// production environment outright moved to `config.ts` in hardening phase 4.1 and
// is tested in `config.test.ts`; what is left here is the selection itself —
// synthetic by default, SQLite when MARKETDATA_DB is set.
//
// The configuration is built with the real `loadConfig`, so these cases go through
// the same validation the running service does rather than a hand-made object.
// The SQLite fixture is built with the STORY-031 importer's writer so the
// dev/test-allowed path is exercised against a real "produced by STORY-031" DB.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EodDatabase } from '../tools/eod-import/db.ts';
import { providerFromConfig } from './universe.ts';
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
let pointer: string; // temp dev-active-db pointer so tests never touch the repo's
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'universe-'));
  aaplDb = join(dir, 'aapl.db');
  pointer = join(dir, '.dev-active-db');
  makeDb(aaplDb, ['AAPL']);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const cfg = (extra: Partial<NodeJS.ProcessEnv> = {}) => loadConfig(extra as NodeJS.ProcessEnv);

describe('providerFromConfig adapter selection', () => {
  it('serves synthetic by default when no MARKETDATA_DB is set', () => {
    const provider = providerFromConfig(cfg({ NODE_ENV: 'development' }), pointer);
    const universe = provider.getUniverse();
    // The synthetic generator yields its multi-name demo universe.
    expect(universe.length).toBeGreaterThan(1);
    expect(universe.some((i) => i.ticker === 'AAPL')).toBe(true);
  });

  it('serves SQLite when MARKETDATA_DB points at a STORY-031 DB', () => {
    const provider = providerFromConfig(cfg({ NODE_ENV: 'test', MARKETDATA_DB: aaplDb }), pointer);
    const universe = provider.getUniverse();
    expect(universe.map((i) => i.ticker)).toEqual(['AAPL']);
  });

  it('treats an unset NODE_ENV as non-production (synthetic default)', () => {
    const provider = providerFromConfig(cfg(), pointer);
    expect(provider.getUniverse().length).toBeGreaterThan(1);
  });
});
