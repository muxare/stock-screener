// run.test.ts — acceptance tests for the EOD CSV → SQLite importer (STORY-031).
//
// Covers each acceptance criterion: schema (SAD#6.1), configurable column
// mapping, both file layouts, idempotent upsert, malformed-row reporting,
// explicit sector/name resolution, and a representative-size perf check.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { normalizeConfig } from './config.ts';
import { parseCSV, normalizeDate, normalizeTicker, parseFile } from './parse.ts';
import { runImport } from './run.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string) => join(FIXTURES, name);

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'eod-import-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

interface InstrumentRecord { ticker: string; name: string; sector: string; }
interface BarRecord { ticker: string; date: string; o: number; h: number; l: number; c: number; v: number; }

function readDb(path: string) {
  const db = new DatabaseSync(path);
  const instruments = db.prepare('SELECT * FROM instrument ORDER BY ticker').all() as unknown as InstrumentRecord[];
  const bars = db.prepare('SELECT * FROM bar ORDER BY ticker, date').all() as unknown as BarRecord[];
  db.close();
  return { instruments, bars };
}

const multiConfig = normalizeConfig({
  columns: {
    ticker: 'Ticker', date: 'Date', open: 'Open', high: 'High',
    low: 'Low', close: 'Close', volume: 'Volume', name: 'Name', sector: 'Sector',
  },
  dateFormat: 'iso',
});

// No ticker/name/sector columns — exercises filename + default fallbacks.
const bareConfig = normalizeConfig({
  columns: { date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume' },
  dateFormat: 'iso',
});

// Stooq-shaped: yyyymmdd dates, ticker column with a `.US` suffix to strip.
const stooqConfig = normalizeConfig({
  columns: {
    ticker: 'Ticker', date: 'Date', open: 'Open', high: 'High',
    low: 'Low', close: 'Close', volume: 'Volume',
  },
  dateFormat: 'yyyymmdd',
  ticker: { case: 'upper', stripSuffix: '.US' },
});

// ---------- pure helpers ----------

describe('parseCSV', () => {
  it('handles quoted fields, embedded commas, and escaped quotes', () => {
    const rows = parseCSV('a,b\n"x,y","he said ""hi"""\n');
    expect(rows).toEqual([['a', 'b'], ['x,y', 'he said "hi"']]);
  });
  it('handles CRLF line endings and ignores a trailing newline', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('normalizeDate', () => {
  it('normalizes each supported format to ISO', () => {
    expect(normalizeDate('2024-01-15', 'iso')).toBe('2024-01-15');
    expect(normalizeDate('20240115', 'yyyymmdd')).toBe('2024-01-15');
    expect(normalizeDate('01/15/2024', 'mm/dd/yyyy')).toBe('2024-01-15');
    expect(normalizeDate('15/01/2024', 'dd/mm/yyyy')).toBe('2024-01-15');
  });
  it('rejects malformed and impossible dates', () => {
    expect(normalizeDate('not-a-date', 'iso')).toBeNull();
    expect(normalizeDate('2024-02-30', 'iso')).toBeNull();
    expect(normalizeDate('20241301', 'yyyymmdd')).toBeNull();
  });
});

describe('normalizeTicker', () => {
  it('strips a configured suffix and applies case', () => {
    expect(normalizeTicker('goog.us', { case: 'upper', stripSuffix: '.US' })).toBe('GOOG');
    expect(normalizeTicker('AAPL', { case: 'lower' })).toBe('aapl');
    expect(normalizeTicker(' msft ', { case: 'none' })).toBe('msft');
  });
});

// ---------- AC: schema (SAD#6.1) ----------

describe('schema', () => {
  it('writes the SAD#6.1 instrument + bar tables keyed on (ticker, date)', () => {
    const out = join(dir, 'out.db');
    runImport([fixture('multi.csv')], out, multiConfig);
    const db = new DatabaseSync(out);
    type ColInfo = { name: string; pk: number };
    const cols = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as unknown as ColInfo[]).map((r) => r.name);
    expect(cols('instrument')).toEqual(['ticker', 'name', 'sector']);
    expect(cols('bar')).toEqual(['ticker', 'date', 'o', 'h', 'l', 'c', 'v']);
    // primary key on (ticker, date)
    const pk = (db.prepare(`PRAGMA table_info(bar)`).all() as unknown as ColInfo[])
      .filter((r) => r.pk > 0).map((r) => r.name).sort();
    expect(pk).toEqual(['date', 'ticker']);
    db.close();
  });
});

// ---------- AC: multi-ticker layout + valid bars ----------

describe('multi-ticker file', () => {
  it('imports valid bars and resolves names/sectors from columns', () => {
    const out = join(dir, 'out.db');
    const report = runImport([fixture('multi.csv')], out, multiConfig);
    expect(report.bars).toBe(4);
    expect(report.instruments).toBe(2);

    const { instruments, bars } = readDb(out);
    expect(instruments).toEqual([
      { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
      { ticker: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology' },
    ]);
    expect(bars[0]).toEqual({
      ticker: 'AAPL', date: '2024-01-02', o: 185.0, h: 186.5, l: 184.1, c: 185.9, v: 52000000,
    });
    // bars are in chronological order per ticker
    expect(bars.filter((b) => b.ticker === 'AAPL').map((b) => b.date))
      .toEqual(['2024-01-02', '2024-01-03']);
  });
});

// ---------- AC: malformed / blank rows reported + skipped ----------

describe('malformed rows', () => {
  it('reports and skips bad rows without aborting the run', () => {
    const out = join(dir, 'out.db');
    const report = runImport([fixture('multi.csv')], out, multiConfig);
    // blank-cells row + bad date + bad open = 3 skipped
    expect(report.skipped).toBe(3);
    expect(report.errors).toHaveLength(3);
    const reasons = report.errors.map((e) => e.reason);
    expect(reasons).toContain('blank row');
    expect(reasons.some((r) => r.includes('bad date'))).toBe(true);
    expect(reasons.some((r) => r.includes('bad open'))).toBe(true);
    // good bars still landed
    expect(report.bars).toBe(4);
    for (const e of report.errors) {
      expect(e.file).toContain('multi.csv');
      expect(typeof e.line).toBe('number');
    }
  });
});

// ---------- AC: one-file-per-ticker layout (filename fallback) ----------

describe('one file per ticker', () => {
  it('takes the ticker from the filename when no ticker column is mapped', () => {
    const out = join(dir, 'out.db');
    const report = runImport([fixture('AAPL.csv')], out, bareConfig);
    expect(report.instruments).toBe(1);
    expect(report.bars).toBe(3);
    const { instruments } = readDb(out);
    // name falls back to ticker; sector to 'Unknown' (no column, no metadata)
    expect(instruments).toEqual([{ ticker: 'AAPL', name: 'AAPL', sector: 'Unknown' }]);
  });
});

// ---------- AC: configurable mapping (date format + ticker normalization) ----------

describe('configurable mapping', () => {
  it('parses yyyymmdd dates and strips the ticker suffix via config alone', () => {
    const out = join(dir, 'out.db');
    runImport([fixture('goog.us.csv')], out, stooqConfig);
    const { instruments, bars } = readDb(out);
    expect(instruments.map((i) => i.ticker)).toEqual(['GOOG']);
    expect(bars.map((b) => b.date)).toEqual(['2024-01-02', '2024-01-03']);
  });
});

// ---------- AC: idempotent re-run ----------

describe('idempotency', () => {
  it('re-running the same input produces no duplicates', () => {
    const out = join(dir, 'out.db');
    runImport([fixture('multi.csv')], out, multiConfig);
    runImport([fixture('multi.csv')], out, multiConfig);
    const { instruments, bars } = readDb(out);
    expect(instruments).toHaveLength(2);
    expect(bars).toHaveLength(4);
  });

  it('upserts: a changed bar overwrites in place', () => {
    const out = join(dir, 'out.db');
    const csv = 'Ticker,Date,Open,High,Low,Close,Volume\nAAPL,2024-01-02,1,1,1,1,1\n';
    const f1 = join(dir, 'a.csv'); writeFileSync(f1, csv);
    runImport([f1], out, normalizeConfig({
      columns: { ticker: 'Ticker', date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume' },
      dateFormat: 'iso',
    }));
    const f2 = join(dir, 'b.csv');
    writeFileSync(f2, 'Ticker,Date,Open,High,Low,Close,Volume\nAAPL,2024-01-02,9,9,9,9,9\n');
    runImport([f2], out, normalizeConfig({
      columns: { ticker: 'Ticker', date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume' },
      dateFormat: 'iso',
    }));
    const { bars } = readDb(out);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ ticker: 'AAPL', c: 9, v: 9 });
  });
});

// ---------- AC: explicit sector/name resolution precedence ----------

describe('sector/name resolution', () => {
  it('falls back to the metadata file when a row carries no sector/name', () => {
    const out = join(dir, 'out.db');
    runImport([fixture('AAPL.csv')], out, bareConfig, {
      AAPL: { name: 'Apple Inc.', sector: 'Technology' },
    });
    const { instruments } = readDb(out);
    expect(instruments).toEqual([{ ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology' }]);
  });

  it("stores sector 'Unknown' and name = ticker when nothing supplies them", () => {
    const out = join(dir, 'out.db');
    runImport([fixture('AAPL.csv')], out, bareConfig);
    const { instruments } = readDb(out);
    expect(instruments[0].sector).toBe('Unknown');
    expect(instruments[0].name).toBe('AAPL');
  });
});

// ---------- AC: config validation ----------

describe('config validation', () => {
  it('rejects a config missing a required column', () => {
    expect(() => normalizeConfig({ columns: { date: 'Date' } }))
      .toThrow(/columns\.open is required/);
  });
  it('rejects an unsupported date format', () => {
    expect(() => normalizeConfig({
      columns: { date: 'd', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' },
      dateFormat: 'bogus',
    })).toThrow(/dateFormat/);
  });
});

// ---------- header-missing-column is reported, not thrown ----------

describe('header mismatch', () => {
  it('reports a missing mapped column instead of crashing', () => {
    const f = join(dir, 'bad.csv');
    writeFileSync(f, 'Date,Open\n2024-01-02,1\n');
    const { bars, errors } = parseFile('Date,Open\n2024-01-02,1\n', f, bareConfig, 'X');
    expect(bars).toHaveLength(0);
    expect(errors[0].reason).toMatch(/missing mapped column/);
  });
});

// ---------- AC: representative-size perf ----------

describe('performance', () => {
  it('imports a multi-year, multi-hundred-ticker dataset in seconds', () => {
    const TICKERS = 300;
    const DAYS = 252 * 5; // ~5 years
    const rows: string[] = ['Ticker,Date,Open,High,Low,Close,Volume'];
    for (let t = 0; t < TICKERS; t++) {
      const ticker = `T${String(t).padStart(4, '0')}`;
      let day = Date.UTC(2019, 0, 1);
      for (let d = 0; d < DAYS; d++) {
        const dt = new Date(day);
        const iso = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        const base = 50 + (t % 100);
        rows.push(`${ticker},${iso},${base},${base + 1},${base - 1},${base + 0.5},${1000000 + d}`);
        day += 86400000;
      }
    }
    const csv = join(dir, 'big.csv');
    writeFileSync(csv, rows.join('\n') + '\n');
    const out = join(dir, 'big.db');

    const started = Date.now();
    const report = runImport([csv], out, normalizeConfig({
      columns: { ticker: 'Ticker', date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume' },
      dateFormat: 'iso',
    }));
    const elapsed = Date.now() - started;

    expect(report.bars).toBe(TICKERS * DAYS);
    expect(report.instruments).toBe(TICKERS);
    // "dev-acceptable time (seconds)" — generous ceiling to avoid CI flakiness.
    expect(elapsed).toBeLessThan(10000);
  });
});
