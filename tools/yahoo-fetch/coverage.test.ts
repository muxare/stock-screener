// coverage.test.ts — acceptance tests for the coverage & freshness reporter +
// partial-failure policy (STORY-053, SAD-003#5.3, CAP-eod-coverage).
//
// Covers each acceptance criterion: every requested ticker appears in the report
// as fetched or failed WITH a reason (a silently-dropped name is a test failure,
// SAD-003#2.4); coverage = % fetched and freshness = max staleness (newest
// written bar vs the last trading day) are present and correct; on partial
// failure the successful set is committed by runBackfill while failures are named
// (ADR-005); and the threshold drives the meets/does-not-meet verdict that the
// CLI maps to a non-zero exit. The end-to-end test injects HTTP, so there is NO
// live network (SAD-003#8.6 / ADR-006).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCoverageReport,
  formatReport,
  lastTradingDay,
  newestBarDate,
  stalenessDays,
} from './coverage.ts';
import type { FetchFailure } from './fetch.ts';
import type { HttpFetch } from './fetch.ts';
import { runBackfill } from './backfill.ts';
import type { DateRange } from './parse.ts';

const fail = (ticker: string, reason: FetchFailure['reason'], message = 'x', attempts = 1): FetchFailure => ({
  ticker,
  reason,
  message,
  attempts,
});

// ---------- last trading day: pragmatic weekday rollback, no calendar service ----------

describe('lastTradingDay', () => {
  it('is the same date on a weekday', () => {
    // 2024-01-05 is a Friday.
    expect(lastTradingDay(new Date('2024-01-05T00:00:00Z')).toISOString().slice(0, 10)).toBe('2024-01-05');
  });
  it('rolls a Saturday back to Friday', () => {
    expect(lastTradingDay(new Date('2024-01-06T00:00:00Z')).toISOString().slice(0, 10)).toBe('2024-01-05');
  });
  it('rolls a Sunday back to Friday', () => {
    expect(lastTradingDay(new Date('2024-01-07T00:00:00Z')).toISOString().slice(0, 10)).toBe('2024-01-05');
  });
});

describe('stalenessDays', () => {
  it('counts whole days the newest bar lags the last trading day', () => {
    expect(stalenessDays('2024-01-02', new Date('2024-01-05T00:00:00Z'))).toBe(3);
  });
  it('clamps to 0 when the newest bar is on/after the last trading day', () => {
    expect(stalenessDays('2024-01-05', new Date('2024-01-05T00:00:00Z'))).toBe(0);
    expect(stalenessDays('2024-01-06', new Date('2024-01-05T00:00:00Z'))).toBe(0);
  });
});

// ---------- buildCoverageReport: coverage %, freshness, no silent drop ----------

describe('buildCoverageReport', () => {
  it('names every requested ticker fetched or failed, with a reason per failure', () => {
    const report = buildCoverageReport({
      requested: ['AAPL', 'NOPE'],
      succeeded: ['AAPL'],
      failures: [fail('NOPE', 'not-found', 'unknown symbol', 2)],
      newestBarDate: '2024-01-04',
      asOf: new Date('2024-01-05T00:00:00Z'),
      minCoverage: 0.5,
    });

    expect(report.requested).toBe(2);
    expect(report.fetched).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.coverage).toBeCloseTo(0.5);
    expect(report.meetsThreshold).toBe(true); // 0.5 >= 0.5

    // Coverage AND freshness are present and correct.
    expect(report.lastTradingDay).toBe('2024-01-05');
    expect(report.newestBarDate).toBe('2024-01-04');
    expect(report.maxStalenessDays).toBe(1);

    // Every requested name has exactly one outcome — none silently dropped.
    expect(report.outcomes.map((o) => o.ticker).sort()).toEqual(['AAPL', 'NOPE']);
    const nope = report.outcomes.find((o) => o.ticker === 'NOPE')!;
    expect(nope.status).toBe('failed');
    expect(nope.reason).toBe('not-found');
    expect(nope.message).toBe('unknown symbol');
    expect(report.outcomes.find((o) => o.ticker === 'AAPL')!.status).toBe('fetched');
  });

  it('exits-criteria: meetsThreshold is false when coverage is below the threshold', () => {
    const report = buildCoverageReport({
      requested: ['AAPL', 'NOPE'],
      succeeded: ['AAPL'],
      failures: [fail('NOPE', 'not-found')],
      newestBarDate: '2024-01-04',
      asOf: new Date('2024-01-05T00:00:00Z'),
      minCoverage: 1.0,
    });
    expect(report.coverage).toBeCloseTo(0.5);
    expect(report.meetsThreshold).toBe(false); // 0.5 < 1.0 → CLI exits non-zero
  });

  it('surfaces a silently-dropped name (reported by neither success nor failure) as a failure', () => {
    const report = buildCoverageReport({
      requested: ['AAPL', 'GHOST'],
      succeeded: ['AAPL'],
      failures: [], // GHOST appears nowhere — a drop
      newestBarDate: '2024-01-04',
      asOf: new Date('2024-01-05T00:00:00Z'),
      minCoverage: 1.0,
    });
    expect(report.failed).toBe(1);
    expect(report.coverage).toBeCloseTo(0.5);
    const ghost = report.outcomes.find((o) => o.ticker === 'GHOST')!;
    expect(ghost.status).toBe('failed');
    expect(ghost.reason).toBe('missing');
  });

  it('reports null freshness when no bars were written', () => {
    const report = buildCoverageReport({
      requested: ['NOPE'],
      succeeded: [],
      failures: [fail('NOPE', 'not-found')],
      newestBarDate: null,
      asOf: new Date('2024-01-05T00:00:00Z'),
      minCoverage: 1.0,
    });
    expect(report.coverage).toBe(0);
    expect(report.newestBarDate).toBeNull();
    expect(report.maxStalenessDays).toBeNull();
  });
});

// ---------- formatReport: printable, hides no name ----------

describe('formatReport', () => {
  it('prints coverage, freshness, fetched names and every failure with its reason', () => {
    const report = buildCoverageReport({
      requested: ['AAPL', 'NOPE'],
      succeeded: ['AAPL'],
      failures: [fail('NOPE', 'not-found', 'unknown symbol', 2)],
      newestBarDate: '2024-01-04',
      asOf: new Date('2024-01-05T00:00:00Z'),
      minCoverage: 1.0,
    });
    const text = formatReport(report);
    expect(text).toContain('coverage: 1/2 (50.0%)');
    expect(text).toContain('threshold 100.0% NOT MET');
    expect(text).toContain('max staleness 1 day(s)');
    expect(text).toContain('AAPL'); // the fetched name is not hidden
    expect(text).toContain('NOPE: not-found — unknown symbol (after 2 attempt(s))');
  });
});

// ---------- end-to-end: partial failure commits the rest, report is correct ----------

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const AAPL_BODY = fixture('AAPL.chart.json');
const NOT_FOUND_BODY = fixture('not-found.chart.json');
const RANGE: DateRange = { from: new Date('2024-01-02T00:00:00Z'), to: new Date('2024-01-05T00:00:00Z') };

// Route by ticker: a 404 not-found for NOPE, the recorded AAPL response
// otherwise. No live network (ADR-006).
const routedHttp: HttpFetch = async (url) =>
  url.includes('/NOPE') ? { status: 404, body: NOT_FOUND_BODY } : { status: 200, body: AAPL_BODY };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yahoo-coverage-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('coverage over a real backfill', () => {
  it('commits the rest, names the failure, and reports correct coverage + max staleness', async () => {
    const dbPath = join(dir, 'yahoo.db');
    const backfill = await runBackfill({ tickers: ['AAPL', 'NOPE'], range: RANGE, dbPath, http: routedHttp });

    // The successful set is committed despite the partial failure (ADR-005).
    expect(backfill.succeeded).toEqual(['AAPL']);
    expect(backfill.failures.map((f) => f.ticker)).toEqual(['NOPE']);

    // Build the run report exactly as the CLI does: freshness from the committed
    // DB's newest WRITTEN bar (2024-01-04, the fixture's last non-null slot).
    const newest = newestBarDate(dbPath);
    expect(newest).toBe('2024-01-04');

    const report = buildCoverageReport({
      requested: backfill.succeeded.concat(backfill.failures.map((f) => f.ticker)),
      succeeded: backfill.succeeded,
      failures: backfill.failures,
      newestBarDate: newest,
      asOf: RANGE.to, // 2024-01-05 (Friday)
      minCoverage: 1.0,
    });

    expect(report.coverage).toBeCloseTo(0.5);
    expect(report.maxStalenessDays).toBe(1); // 2024-01-05 − 2024-01-04
    expect(report.meetsThreshold).toBe(false); // below 100% → CLI exits non-zero

    // The failure is named with a reason; the success is named too — no drops.
    const named = new Set(report.outcomes.map((o) => o.ticker));
    expect(named).toEqual(new Set(['AAPL', 'NOPE']));
    expect(report.outcomes.find((o) => o.ticker === 'NOPE')!.reason).toBe('not-found');
  });

  it('reports null freshness and zero coverage when every ticker fails', async () => {
    const dbPath = join(dir, 'yahoo.db');
    const backfill = await runBackfill({ tickers: ['NOPE', 'NOPE2'], range: RANGE, dbPath, http: routedHttp });

    const report = buildCoverageReport({
      requested: backfill.succeeded.concat(backfill.failures.map((f) => f.ticker)),
      succeeded: backfill.succeeded,
      failures: backfill.failures,
      newestBarDate: newestBarDate(dbPath),
      asOf: RANGE.to,
      minCoverage: 0, // even a 0 threshold: a fully-failed run is reportable
    });

    expect(report.coverage).toBe(0);
    expect(report.maxStalenessDays).toBeNull();
    expect(report.outcomes.map((o) => o.ticker)).toEqual(['NOPE', 'NOPE2']);
    expect(report.outcomes.every((o) => o.status === 'failed')).toBe(true);
  });
});
