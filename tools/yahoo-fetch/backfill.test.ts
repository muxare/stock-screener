// backfill.test.ts — acceptance tests for the fetch → import seam (STORY-051,
// SAD-003#5.2, CAP-eod-ingest).
//
// Covers each acceptance criterion: a backfill over a SUPPLIED ticker list
// normalises fetched rows into the importer's CSV input and runs the EXISTING
// importer to write the DB (ADR-002); `bar.c ← adjClose` with raw o/h/l/v and no
// corporate-action math (SAD-003#6.1 / ADR-004); the written DB is served by the
// UNCHANGED STORY-032 `sqliteProvider`, so pointing it at the Yahoo DB serves
// exactly as synthetic (SAD-003#2.1); name/sector resolve via the importer's
// metadata precedence; re-running is idempotent (SAD-003#2.2 upsert); failures
// are reported, never silently dropped (SAD-003#2.4); and the HTTP layer is
// injected so there is NO live network (SAD-003#8.6 / ADR-006).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { runBackfill, toImporterCsv } from './backfill.ts';
import type { FetchResult } from './fetch.ts';
import type { HttpFetch } from './fetch.ts';
import type { DateRange } from './parse.ts';
// The read side, imported UNCHANGED — proves the Yahoo DB serves through the
// existing port with no edit to provider.ts / sqlite.ts (SAD-003#2.1).
import { sqliteProvider } from '../../src/lib/data/sqlite.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const AAPL_BODY = fixture('AAPL.chart.json');
const NOT_FOUND_BODY = fixture('not-found.chart.json');

const RANGE: DateRange = { from: new Date('2024-01-02T00:00:00Z'), to: new Date('2024-01-05T00:00:00Z') };

// The AAPL fixture's first trading bar (mirrors fetch.test.ts): adjClose is
// DISTINCT from raw close, which is exactly what `bar.c ← adjClose` must capture.
const AAPL_FIRST = { date: '2024-01-02', open: 187.15, high: 188.44, low: 183.89, close: 185.64, adjClose: 167.076 };

// A canned HTTP layer that routes by ticker in the URL: a 404 not-found for one
// symbol, the recorded AAPL response otherwise. No live network (ADR-006).
const routedHttp: HttpFetch = async (url) =>
  url.includes('/NOPE') ? { status: 404, body: NOT_FOUND_BODY } : { status: 200, body: AAPL_BODY };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yahoo-backfill-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// ---------- AC: normalise to the importer's CSV, adjClose → Close ----------

describe('toImporterCsv', () => {
  it('writes adjClose into the Close column and carries raw o/h/l/v verbatim', () => {
    const results: FetchResult[] = [
      {
        ok: true,
        ticker: 'AAPL',
        bars: [{ date: '2024-01-02', open: 1, high: 2, low: 0.5, close: 9, adjClose: 8.1, volume: 100 }],
      },
    ];
    const csv = toImporterCsv(results);
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe('Company,Date,Open,High,Low,Close,Volume');
    // Close column holds adjClose (8.1), NOT raw close (9); o/h/l/v are raw.
    expect(row).toBe('AAPL,2024-01-02,1,2,0.5,8.1,100');
  });

  it('contributes no rows for a failed ticker (reported elsewhere, not dropped)', () => {
    const results: FetchResult[] = [
      { ok: false, ticker: 'NOPE', failure: { ticker: 'NOPE', reason: 'not-found', message: 'x', attempts: 1 } },
    ];
    expect(toImporterCsv(results).trim()).toBe('Company,Date,Open,High,Low,Close,Volume');
  });
});

// ---------- AC: backfill → existing importer → DB served by sqliteProvider ----------

describe('runBackfill', () => {
  it('lands fetched bars in a DB the unchanged sqliteProvider serves, with bar.c = adjClose', async () => {
    const dbPath = join(dir, 'yahoo.db');
    const report = await runBackfill({ tickers: ['AAPL'], range: RANGE, dbPath, http: routedHttp });

    expect(report.dbPath).toBe(dbPath);
    expect(report.succeeded).toEqual(['AAPL']);
    expect(report.instruments).toBe(1);
    expect(report.bars).toBe(3); // 3 trading bars (the 4th fixture slot is null)

    // Serve it through the EXISTING read adapter — the same path the app uses.
    const provider = sqliteProvider(dbPath);
    const inst = provider.getInstrument('AAPL');
    expect(inst).not.toBeNull();
    // Name/sector resolved via the importer's metadata file precedence
    // (config.yahoo.json → metadata.synthetic.json), since Yahoo carries none.
    expect(inst!.name).toBe('Apple Inc.');
    expect(inst!.sector).toBe('Technology');

    expect(inst!.bars).toHaveLength(3);
    expect(inst!.dates?.[0]).toBe(AAPL_FIRST.date);
    // bar.c is the ADJUSTED close, not the raw close (SAD-003#6.1 / ADR-004)…
    expect(inst!.bars[0].c).toBe(AAPL_FIRST.adjClose);
    expect(inst!.bars[0].c).not.toBe(AAPL_FIRST.close);
    // …and o/h/l/v are the RAW values (no corporate-action math).
    expect(inst!.bars[0].o).toBe(AAPL_FIRST.open);
    expect(inst!.bars[0].h).toBe(AAPL_FIRST.high);
    expect(inst!.bars[0].l).toBe(AAPL_FIRST.low);
  });

  it('is idempotent: a second run adds no duplicate rows (importer upsert)', async () => {
    const dbPath = join(dir, 'yahoo.db');
    const opts = { tickers: ['AAPL'], range: RANGE, dbPath, http: routedHttp };

    await runBackfill(opts);
    const after1 = countBars(dbPath);
    await runBackfill(opts);
    const after2 = countBars(dbPath);

    expect(after1).toBe(3);
    expect(after2).toBe(after1); // upsert on (ticker,date) — no duplicates
  });

  it('commits the successful set and reports failures, never silently dropping a name', async () => {
    const dbPath = join(dir, 'yahoo.db');
    const report = await runBackfill({ tickers: ['AAPL', 'NOPE'], range: RANGE, dbPath, http: routedHttp });

    expect(report.requested).toBe(2);
    expect(report.succeeded).toEqual(['AAPL']);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ ticker: 'NOPE', reason: 'not-found' });

    // The successful name is committed despite the partial failure.
    expect(sqliteProvider(dbPath).getInstrument('AAPL')).not.toBeNull();
    expect(sqliteProvider(dbPath).getInstrument('NOPE')).toBeNull();
  });

  it('reports every failure and writes no bars when all tickers fail (no crash, no silent drop)', async () => {
    const dbPath = join(dir, 'yahoo.db');
    const report = await runBackfill({ tickers: ['NOPE', 'NOPE2'], range: RANGE, dbPath, http: routedHttp });

    expect(report.requested).toBe(2);
    expect(report.succeeded).toEqual([]);
    expect(report.failures.map((f) => f.ticker)).toEqual(['NOPE', 'NOPE2']);
    expect(report.bars).toBe(0);
    // An empty-but-valid DB is produced; the unchanged reader serves no names.
    expect(sqliteProvider(dbPath).getInstrument('NOPE')).toBeNull();
  });

  it('de-duplicates a repeated ticker: fetched once, reported once', async () => {
    const dbPath = join(dir, 'yahoo.db');
    const report = await runBackfill({ tickers: ['AAPL', 'AAPL'], range: RANGE, dbPath, http: routedHttp });

    expect(report.requested).toBe(1); // distinct names, not the supplied length
    expect(report.succeeded).toEqual(['AAPL']);
    expect(countBars(dbPath)).toBe(3); // no doubled rows
  });
});

// Count bar rows directly (read-only) to assert idempotency.
function countBars(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM bar').get() as unknown as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}
