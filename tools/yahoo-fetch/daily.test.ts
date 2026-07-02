// daily.test.ts — acceptance tests for the daily post-close APPEND run mode
// (STORY-052, SAD-003#3.2 / SAD-003#5.2, CAP-eod-ingest).
//
// Covers each acceptance criterion: a daily run fetches bars SINCE the last
// stored bar per ticker and appends them through the SAME importer path as the
// backfill (SAD-003#5.2); re-running the same day is IDEMPOTENT — no duplicate
// rows, same-date bars overwritten in place via the importer's
// ON CONFLICT(ticker,date) upsert (SAD-003#2.2); the run is a single-shot CLI
// that builds NO scheduler (SAD-003#8.8 / ADR-008); an interrupted/partial run is
// recovered by simply re-running; and it targets the same Yahoo DB path, served
// unchanged by STORY-032's sqliteProvider (SAD-003#6.2 / SAD-003#2.1). The HTTP
// layer is injected so there is NO live network (SAD-003#8.6 / ADR-006).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runDailyAppend, lastBarDates } from './daily.ts';
import type { HttpFetch } from './fetch.ts';
// The read side, imported UNCHANGED — proves the appended DB still serves through
// the existing port with no edit to provider.ts / sqlite.ts (SAD-003#2.1).
import { sqliteProvider } from '../../src/lib/data/sqlite.ts';

interface FixtureBar { date: string; close: number; adjClose: number }

// Build a minimal-but-valid Yahoo v8 `chart` envelope for a set of bars, so a
// test controls exactly which dates a fetch returns. gmtoffset 0 + noon-UTC
// timestamps mean each bar labels to its own calendar date (parse.ts shifts by
// gmtoffset then takes the UTC date). Raw o/h/l are derived off close and kept
// DISTINCT from adjClose so `bar.c ← adjClose` is observable.
function chartBody(bars: FixtureBar[]): string {
  const ts = bars.map((b) => Math.floor(Date.parse(`${b.date}T12:00:00Z`) / 1000));
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: { gmtoffset: 0 },
          timestamp: ts,
          indicators: {
            quote: [
              {
                open: bars.map((b) => b.close),
                high: bars.map((b) => b.close + 1),
                low: bars.map((b) => b.close - 1),
                close: bars.map((b) => b.close),
                volume: bars.map(() => 1000),
              },
            ],
            adjclose: [{ adjclose: bars.map((b) => b.adjClose) }],
          },
        },
      ],
      error: null,
    },
  });
}

const NOT_FOUND_BODY = JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } });

// A controllable HTTP layer: records every requested URL and returns a body
// chosen by a test-settable router. It IGNORES the period params (like a canned
// fixture), so the *window* a run requests is asserted via the recorded URL while
// the *bars* returned are whatever the current phase dictates.
let requestedUrls: string[];
let router: (ticker: string, url: string) => { status: number; body: string };
const recordingHttp: HttpFetch = async (url) => {
  requestedUrls.push(url);
  const ticker = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  return router(ticker, url);
};

// The unix period1 the endpoint sees for an inclusive `from` date (parse.ts uses
// from.getTime()/1000 with no offset; period2 is the +1-day bump, not asserted).
const period1Of = (fromIso: string): string => String(Math.floor(Date.parse(`${fromIso}T00:00:00Z`) / 1000));
const period1In = (url: string): string | null => new URL(url).searchParams.get('period1');

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yahoo-daily-test-'));
  dbPath = join(dir, 'yahoo.db');
  requestedUrls = [];
  router = () => ({ status: 200, body: chartBody([{ date: '2024-01-02', close: 10, adjClose: 9 }]) });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// Count bar rows (read-only) to assert idempotency.
function countBars(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM bar').get() as unknown as { n: number }).n;
  } finally {
    db.close();
  }
}

// The stored (date → c) map for one ticker, to assert overwrite-in-place.
function storedBars(path: string, ticker: string): Record<string, number> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare('SELECT date, c FROM bar WHERE ticker = ? ORDER BY date').all(ticker) as unknown as {
      date: string;
      c: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.date, r.c]));
  } finally {
    db.close();
  }
}

// ---------- AC: fetches SINCE the last stored bar, appends the new bars ----------

describe('runDailyAppend — since the last stored bar', () => {
  it('fetches from the last stored bar date and appends the newer bars', async () => {
    // Seed: store AAPL through 2024-01-03.
    router = () => ({ status: 200, body: chartBody([
      { date: '2024-01-02', close: 10, adjClose: 9 },
      { date: '2024-01-03', close: 11, adjClose: 10 },
    ]) });
    await runDailyAppend({ tickers: ['AAPL'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });
    expect(storedBars(dbPath, 'AAPL')['2024-01-03']).toBe(10);

    // Daily run: newer bars arrive, and 2024-01-03's adjClose is revised.
    requestedUrls = [];
    router = () => ({ status: 200, body: chartBody([
      { date: '2024-01-03', close: 11, adjClose: 10.5 }, // revised same-date bar
      { date: '2024-01-04', close: 12, adjClose: 11 },
      { date: '2024-01-05', close: 13, adjClose: 12 },
    ]) });
    const report = await runDailyAppend({ tickers: ['AAPL'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });

    // The fetch window starts at the LAST STORED bar (2024-01-03), not the epoch.
    expect(requestedUrls).toHaveLength(1);
    expect(period1In(requestedUrls[0])).toBe(period1Of('2024-01-03'));

    // The new bars were appended…
    const bars = storedBars(dbPath, 'AAPL');
    expect(Object.keys(bars).sort()).toEqual(['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']);
    // …and the re-fetched 2024-01-03 was OVERWRITTEN IN PLACE (bar.c ← adjClose).
    expect(bars['2024-01-03']).toBe(10.5);
    expect(report.succeeded).toEqual(['AAPL']);
    expect(report.bars).toBe(3); // the 3 rows in the daily response, upserted
  });

  it('computes a distinct window PER ticker from each ticker\'s own last bar', async () => {
    // Seed AAPL through 2024-01-03 and MSFT through 2024-01-02.
    router = (ticker) => ({ status: 200, body: ticker === 'MSFT'
      ? chartBody([{ date: '2024-01-02', close: 20, adjClose: 19 }])
      : chartBody([{ date: '2024-01-02', close: 10, adjClose: 9 }, { date: '2024-01-03', close: 11, adjClose: 10 }]) });
    await runDailyAppend({ tickers: ['AAPL', 'MSFT'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });

    // Daily run: each ticker's window must start at ITS OWN last stored bar.
    requestedUrls = [];
    router = (ticker) => ({ status: 200, body: chartBody([{ date: '2024-01-05', close: ticker === 'MSFT' ? 25 : 15, adjClose: ticker === 'MSFT' ? 24 : 14 }]) });
    await runDailyAppend({ tickers: ['AAPL', 'MSFT'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });

    const byTicker = new Map(requestedUrls.map((u) => [decodeURIComponent(new URL(u).pathname.split('/').pop() ?? ''), period1In(u)]));
    expect(byTicker.get('AAPL')).toBe(period1Of('2024-01-03')); // AAPL's last bar
    expect(byTicker.get('MSFT')).toBe(period1Of('2024-01-02')); // MSFT's last bar
  });

  it('fetches only the run day for a ticker with no stored history (onboarding is backfill\'s job), never dropping it', async () => {
    // Fresh DB, AAPL unknown → window anchors at asOf, and the name still lands.
    router = () => ({ status: 200, body: chartBody([{ date: '2024-01-05', close: 13, adjClose: 12 }]) });
    const report = await runDailyAppend({ tickers: ['AAPL'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });

    expect(period1In(requestedUrls[0])).toBe(period1Of('2024-01-05'));
    expect(report.succeeded).toEqual(['AAPL']);
    expect(storedBars(dbPath, 'AAPL')).toEqual({ '2024-01-05': 12 });
  });
});

// ---------- AC: idempotent re-run — no duplicate rows, overwrite in place ----------

describe('runDailyAppend — idempotency (SAD-003#2.2)', () => {
  it('a second same-day run adds no duplicate rows and overwrites in place', async () => {
    router = () => ({ status: 200, body: chartBody([
      { date: '2024-01-02', close: 10, adjClose: 9 },
      { date: '2024-01-03', close: 11, adjClose: 10 },
    ]) });
    const opts = { tickers: ['AAPL'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp };

    await runDailyAppend(opts);
    const after1 = countBars(dbPath);
    await runDailyAppend(opts);
    const after2 = countBars(dbPath);

    expect(after1).toBe(2);
    expect(after2).toBe(after1); // upsert on (ticker,date) — no duplicates on re-run
    expect(storedBars(dbPath, 'AAPL')).toEqual({ '2024-01-02': 9, '2024-01-03': 10 });
  });
});

// ---------- AC: single-shot, no scheduler (SAD-003#8.8 / ADR-008) ----------

describe('runDailyAppend — externally triggered, no scheduler', () => {
  it('resolves once and registers no timer/interval (builds no scheduler)', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const setTimeout = vi.spyOn(globalThis, 'setTimeout');
    try {
      await runDailyAppend({ tickers: ['AAPL'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });
      // No cron/timer scaffolding: a single-shot run schedules nothing (delayMs
      // defaults to 0, so even the polite inter-batch sleep never fires).
      expect(setInterval).not.toHaveBeenCalled();
      expect(setTimeout).not.toHaveBeenCalled();
    } finally {
      setInterval.mockRestore();
      setTimeout.mockRestore();
    }
  });
});

// ---------- AC: partial run recovered by re-running; same DB, unchanged reader ----------

describe('runDailyAppend — recovery + DB target', () => {
  it('commits the successful set on partial failure and recovers the failed name on re-run', async () => {
    // First run: MSFT 404s, AAPL succeeds → only AAPL committed, MSFT reported.
    router = (ticker) => ticker === 'MSFT'
      ? { status: 404, body: NOT_FOUND_BODY }
      : { status: 200, body: chartBody([{ date: '2024-01-05', close: 13, adjClose: 12 }]) };
    const first = await runDailyAppend({ tickers: ['AAPL', 'MSFT'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });
    expect(first.succeeded).toEqual(['AAPL']);
    expect(first.failures.map((f) => f.ticker)).toEqual(['MSFT']);
    expect(sqliteProvider(dbPath).getInstrument('MSFT')).toBeNull();

    // Re-run (the ADR-008 "just re-run" recovery): MSFT now succeeds and lands;
    // AAPL is re-fetched and upserted in place — no duplicate rows.
    router = () => ({ status: 200, body: chartBody([{ date: '2024-01-05', close: 21, adjClose: 20 }]) });
    const second = await runDailyAppend({ tickers: ['AAPL', 'MSFT'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });
    expect(second.succeeded.sort()).toEqual(['AAPL', 'MSFT']);

    // Served through the UNCHANGED read adapter (SAD-003#2.1); target is exactly
    // the DB we asked for (SAD-003#6.2).
    expect(second.dbPath).toBe(dbPath);
    const provider = sqliteProvider(dbPath);
    expect(provider.getInstrument('MSFT')).not.toBeNull();
    expect(countBars(dbPath)).toBe(2); // AAPL + MSFT, one bar each — no dupes
  });
});

// ---------- unit: last-stored-bar read ----------

describe('lastBarDates', () => {
  it('returns an empty map for a not-yet-created DB (first-ever run proceeds)', () => {
    expect(lastBarDates(join(dir, 'does-not-exist.db')).size).toBe(0);
  });

  it('reports the newest stored date per ticker', async () => {
    router = (ticker) => ({ status: 200, body: ticker === 'MSFT'
      ? chartBody([{ date: '2024-01-02', close: 20, adjClose: 19 }])
      : chartBody([{ date: '2024-01-02', close: 10, adjClose: 9 }, { date: '2024-01-04', close: 12, adjClose: 11 }]) });
    await runDailyAppend({ tickers: ['AAPL', 'MSFT'], asOf: new Date('2024-01-05T00:00:00Z'), dbPath, http: recordingHttp });

    const last = lastBarDates(dbPath);
    expect(last.get('AAPL')).toBe('2024-01-04');
    expect(last.get('MSFT')).toBe('2024-01-02');
  });
});
