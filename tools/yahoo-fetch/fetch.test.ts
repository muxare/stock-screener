// fetch.test.ts — acceptance tests for the Yahoo EOD fetcher (STORY-050).
//
// Covers each acceptance criterion: parsing the v8 `chart` response into
// normalised rows with `adjClose` DISTINCT from raw `close` (SAD-003#3.1); the
// injectable HTTP layer running against RECORDED fixtures with NO live network
// (SAD-003#8.6 / ADR-006); polite batching + bounded retry/backoff with a test
// asserting the backoff path on a simulated transient error (SAD-003#2.7); and
// a structured per-ticker failure that is never silently dropped (SAD-003#2.4).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildChartUrl, parseChart } from './parse.ts';
import type { DateRange } from './parse.ts';
import { fetchTicker, fetchTickers } from './fetch.ts';
import type { HttpFetch, HttpResponse } from './fetch.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const AAPL_BODY = fixture('AAPL.chart.json');
const NOT_FOUND_BODY = fixture('not-found.chart.json');

const RANGE: DateRange = { from: new Date('2024-01-02T00:00:00Z'), to: new Date('2024-01-05T00:00:00Z') };

// A canned HTTP layer returning a fixed response — the recorded-fixture seam.
const respond = (status: number, body: string): HttpFetch => async () => ({ status, body });

// ---------- AC: URL targets the v8 `chart` endpoint via params ----------

describe('buildChartUrl', () => {
  it('targets the Yahoo v8 chart JSON endpoint with daily interval + adjclose', () => {
    const url = buildChartUrl('AAPL', RANGE);
    expect(url).toContain('/v8/finance/chart/AAPL?');
    const qs = new URL(url).searchParams;
    expect(qs.get('interval')).toBe('1d');
    expect(qs.get('includeAdjustedClose')).toBe('true');
    // period1 = from in unix seconds; period2 = to + 1 day (inclusive end).
    expect(qs.get('period1')).toBe(String(Math.floor(RANGE.from.getTime() / 1000)));
    expect(qs.get('period2')).toBe(String(Math.floor(RANGE.to.getTime() / 1000) + 86400));
  });
});

// ---------- AC: parse → normalised rows, adjClose distinct from close ----------

describe('parseChart', () => {
  it('normalises the recorded response into daily rows with adjClose distinct from close', () => {
    const parsed = parseChart(AAPL_BODY);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 4 timestamps, the last is a null/non-trading slot → skipped.
    expect(parsed.bars).toHaveLength(3);
    expect(parsed.bars[0]).toEqual({
      date: '2024-01-02',
      open: 187.15,
      high: 188.44,
      low: 183.89,
      close: 185.64,
      adjClose: 167.076,
      volume: 82488700,
    });
    // adjClose carried through DISTINCT from raw close on every row (no math).
    for (const b of parsed.bars) {
      expect(b.adjClose).not.toBe(b.close);
    }
    expect(parsed.bars.map((b) => b.date)).toEqual(['2024-01-02', '2024-01-03', '2024-01-04']);
  });

  it('returns a structured not-found failure when Yahoo reports a chart error', () => {
    const parsed = parseChart(NOT_FOUND_BODY);
    expect(parsed).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('returns a malformed failure on an unparseable body', () => {
    const parsed = parseChart('<html>429 Too Many Requests</html>');
    expect(parsed).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

// ---------- AC: injectable HTTP against a recorded fixture, no live network ----------

describe('fetchTicker (recorded fixture)', () => {
  it('fetches and normalises one ticker via the injected HTTP layer', async () => {
    const result = await fetchTicker('AAPL', RANGE, { http: respond(200, AAPL_BODY) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticker).toBe('AAPL');
    expect(result.bars).toHaveLength(3);
    expect(result.bars[0].adjClose).toBe(167.076);
  });

  it('surfaces a structured not-found failure without retrying (permanent)', async () => {
    const sleeps: number[] = [];
    const result = await fetchTicker('BOGUS', RANGE, {
      http: respond(404, NOT_FOUND_BODY),
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ ticker: 'BOGUS', reason: 'not-found', attempts: 1, status: 404 });
    expect(sleeps).toHaveLength(0); // not retried
  });
});

// ---------- AC: bounded retry/backoff on a simulated transient error ----------

describe('retry/backoff (SAD-003#2.7)', () => {
  it('retries a transient 503 with exponential backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const http: HttpFetch = async () => {
      calls++;
      const res: HttpResponse = calls < 3 ? { status: 503, body: '' } : { status: 200, body: AAPL_BODY };
      return res;
    };
    const result = await fetchTicker('AAPL', RANGE, {
      http,
      maxAttempts: 3,
      baseDelayMs: 100,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
    // Backed off after each of the two transient failures, exponentially.
    expect(sleeps).toEqual([100, 200]);
  });

  it('retries a thrown network error then surfaces it within the bound', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const http: HttpFetch = async () => { calls++; throw new Error('ECONNRESET'); };
    const result = await fetchTicker('AAPL', RANGE, {
      http,
      maxAttempts: 3,
      baseDelayMs: 50,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(calls).toBe(3); // bounded
    expect(result.failure).toMatchObject({ reason: 'network-error', attempts: 3, message: 'ECONNRESET' });
    expect(sleeps).toEqual([50, 100]); // backoff between the 3 attempts
  });

  it('gives up after the bound on a persistent transient status', async () => {
    const result = await fetchTicker('AAPL', RANGE, {
      http: respond(429, ''),
      maxAttempts: 2,
      baseDelayMs: 1,
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ reason: 'http-error', attempts: 2, status: 429 });
  });
});

// ---------- AC: polite batching surfaces every ticker (no silent drop) ----------

describe('fetchTickers (politeness + coverage)', () => {
  it('honours batch size + inter-batch delay and returns a result per ticker', async () => {
    const sleeps: number[] = [];
    // Route per-ticker: AAPL succeeds, BOGUS is not-found.
    const http: HttpFetch = async (url) =>
      url.includes('/AAPL?') ? { status: 200, body: AAPL_BODY } : { status: 404, body: NOT_FOUND_BODY };

    const results = await fetchTickers(['AAPL', 'BOGUS'], RANGE, {
      http,
      batchSize: 1,
      delayMs: 250,
      sleep: async (ms) => { sleeps.push(ms); },
    });

    expect(results).toHaveLength(2); // every requested ticker is accounted for
    expect(results[0]).toMatchObject({ ok: true, ticker: 'AAPL' });
    expect(results[1]).toMatchObject({ ok: false, ticker: 'BOGUS' });
    // One inter-batch delay between the two single-ticker batches.
    expect(sleeps).toEqual([250]);
  });
});
