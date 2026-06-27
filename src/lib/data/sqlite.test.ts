// sqlite.test.ts — acceptance tests for the SQLite MarketDataProvider adapter
// (STORY-032). Each test maps to an acceptance criterion: port implementation,
// synchronous reads, chronological {o,h,l,c,v} bars, getInstrument semantics,
// service-seam selection, and no-adjustment fidelity.
//
// The fixture DB is built with the STORY-031 importer's writer (EodDatabase) so
// the adapter is exercised against a database "produced by STORY-031", not a
// hand-rolled schema.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EodDatabase } from '../../../tools/eod-import/db.ts';
import type { ParsedBar } from '../../../tools/eod-import/parse.ts';
import { sqliteProvider } from './sqlite.ts';
import { providerFromEnv, rememberDevDb } from '../../../server/universe.ts';
import { buildUniverse } from '../market.ts';

// AAPL bars are deliberately written OUT of chronological order to prove the
// adapter sorts by `date`, not insertion order.
const AAPL_BARS: ParsedBar[] = [
  { ticker: 'AAPL', date: '2024-01-03', o: 3, h: 3.5, l: 2.9, c: 3.2, v: 1200 },
  { ticker: 'AAPL', date: '2024-01-01', o: 1, h: 2, l: 0.5, c: 1.5, v: 900 },
  { ticker: 'AAPL', date: '2024-01-02', o: 2, h: 3, l: 1.8, c: 2.5, v: 1000 },
];
const MSFT_BARS: ParsedBar[] = [
  { ticker: 'MSFT', date: '2024-01-02', o: 20, h: 22, l: 19, c: 21, v: 5000 },
  { ticker: 'MSFT', date: '2024-01-01', o: 18, h: 21, l: 17, c: 20, v: 4800 },
];

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sqlite-provider-'));
  dbPath = join(dir, 'market.db');
  const db = new EodDatabase(dbPath);
  db.write(
    [
      { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
      { ticker: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology' },
    ],
    [...AAPL_BARS, ...MSFT_BARS],
  );
  db.close();
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('sqliteProvider', () => {
  it('implements the MarketDataProvider port, reading a STORY-031 DB', () => {
    const p = sqliteProvider(dbPath);
    const universe = p.getUniverse();
    expect(universe.map((i) => i.ticker)).toEqual(['AAPL', 'MSFT']);
    const aapl = universe.find((i) => i.ticker === 'AAPL')!;
    expect(aapl.name).toBe('Apple Inc.');
    expect(aapl.sector).toBe('Technology');
    expect(aapl.bars).toHaveLength(3);
  });

  it('reads synchronously — results are plain values, not Promises', () => {
    const p = sqliteProvider(dbPath);
    expect(p.getUniverse()).toBeInstanceOf(Array);
    expect(p.getInstrument('AAPL')).not.toBeInstanceOf(Promise);
    expect(p.getInstrument('AAPL')!.bars).toBeInstanceOf(Array);
  });

  it('returns bars in chronological order as Bar{o,h,l,c,v} with no date field', () => {
    const p = sqliteProvider(dbPath);
    const aapl = p.getInstrument('AAPL')!;
    // closes ascend by date even though rows were inserted out of order
    expect(aapl.bars.map((b) => b.c)).toEqual([1.5, 2.5, 3.2]);
    // exactly the engine Bar shape — `date` is an ordering column, not a field
    expect(Object.keys(aapl.bars[0]).sort()).toEqual(['c', 'h', 'l', 'o', 'v']);
  });

  it('returns calendar dates as a parallel array aligned with the chronological bars', () => {
    const p = sqliteProvider(dbPath);
    const aapl = p.getInstrument('AAPL')!;
    // dates ascend with the bars (the chart labels its axis from these), and the
    // array is the same length as `bars` so the two stay index-aligned.
    expect(aapl.dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(aapl.dates).toHaveLength(aapl.bars.length);
    // getUniverse carries the same parallel dates as getInstrument.
    const fromUniverse = p.getUniverse().find((i) => i.ticker === 'AAPL')!;
    expect(fromUniverse.dates).toEqual(aapl.dates);
  });

  it('getInstrument returns metadata + bars, or null for an unknown ticker', () => {
    const p = sqliteProvider(dbPath);
    const msft = p.getInstrument('MSFT');
    expect(msft).not.toBeNull();
    expect(msft!.name).toBe('Microsoft Corp.');
    expect(msft!.bars.map((b) => b.c)).toEqual([20, 21]);
    expect(p.getInstrument('NOPE')).toBeNull();
  });

  it("getInstrument bars are identical to that name's bars in getUniverse", () => {
    const p = sqliteProvider(dbPath);
    const fromUniverse = p.getUniverse().find((i) => i.ticker === 'AAPL')!;
    const fromInstrument = p.getInstrument('AAPL')!;
    expect(fromInstrument).toEqual(fromUniverse);
  });

  it('applies NO adjustment — bars equal the importer-stored values verbatim', () => {
    const p = sqliteProvider(dbPath);
    const aapl = p.getInstrument('AAPL')!;
    const expected = [...AAPL_BARS]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ o, h, l, c, v }) => ({ o, h, l, c, v }));
    expect(aapl.bars).toEqual(expected);
  });

  it('fails fast with a clear error when the DB path cannot be opened', () => {
    const missing = join(dir, 'does-not-exist.db');
    expect(() => sqliteProvider(missing)).toThrow(/could not open market-data DB/);
    expect(() => sqliteProvider(missing)).toThrow(/MARKETDATA_DB/);
  });

  it('fails fast on a valid SQLite file that is not a STORY-031 schema', () => {
    const wrong = join(dir, 'wrong-schema.db');
    const bad = new DatabaseSync(wrong);
    bad.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);');
    bad.close();
    expect(() => sqliteProvider(wrong)).toThrow(/not a STORY-031 market-data DB/);
  });

  it('feeds the engine through the port — buildUniverse consumes its output', () => {
    const p = sqliteProvider(dbPath);
    const stocks = buildUniverse(p.getUniverse());
    expect(stocks.map((s) => s.ticker)).toEqual(['AAPL', 'MSFT']);
    expect(stocks[0].price).toBe(3.2); // last (latest) close
  });
});

describe('providerFromEnv (service seam)', () => {
  it('selects the SQLite adapter when MARKETDATA_DB is set', () => {
    const p = providerFromEnv({ MARKETDATA_DB: dbPath } as NodeJS.ProcessEnv);
    expect(p.getUniverse().map((i) => i.ticker)).toEqual(['AAPL', 'MSFT']);
  });

  it('falls back to the synthetic adapter when MARKETDATA_DB is unset', () => {
    const p = providerFromEnv({} as NodeJS.ProcessEnv);
    // the synthetic universe is the 44-name mulberry32 fixture, not our 2 names
    expect(p.getUniverse().length).toBeGreaterThan(2);
    expect(p.getInstrument('AAPL')).not.toBeNull();
  });

  // STORY-031: an import persists its DB via the dev "active dataset" pointer so
  // the imported data survives a restart instead of reverting to synthetic.
  it('boots from the persisted dev dataset when DEV_TOOLS is on and a pointer exists', () => {
    const pointer = join(dir, '.dev-active-db');
    rememberDevDb(dbPath, pointer);
    const p = providerFromEnv({ DEV_TOOLS: '1' } as NodeJS.ProcessEnv, pointer);
    expect(p.getUniverse().map((i) => i.ticker)).toEqual(['AAPL', 'MSFT']);
  });

  it('ignores the pointer when DEV_TOOLS is off (no silent prod downgrade)', () => {
    const pointer = join(dir, '.dev-active-db');
    rememberDevDb(dbPath, pointer);
    const p = providerFromEnv({} as NodeJS.ProcessEnv, pointer);
    expect(p.getUniverse().length).toBeGreaterThan(2); // synthetic, not our 2 names
  });

  it('falls back to synthetic when the pointer references a deleted DB', () => {
    const pointer = join(dir, '.dev-active-db');
    rememberDevDb(join(dir, 'gone.db'), pointer);
    const p = providerFromEnv({ DEV_TOOLS: '1' } as NodeJS.ProcessEnv, pointer);
    expect(p.getUniverse().length).toBeGreaterThan(2);
  });
});
