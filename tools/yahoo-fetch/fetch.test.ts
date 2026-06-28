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

  it('labels the trading date in the exchange timezone, not UTC (gmtoffset)', () => {
    // An ASX-style listing: open 10:00 AEDT (gmtoffset +39600) for the
    // 2024-01-03 session is 1704236400 = 2024-01-02T23:00:00Z. Without the
    // offset the bar would be mislabelled 2024-01-02 (a day early).
    const body = JSON.stringify({
      chart: {
        result: [
          {
            meta: { gmtoffset: 39600 },
            timestamp: [1704236400],
            indicators: {
              quote: [{ open: [10], high: [11], low: [9], close: [10.5], volume: [100] }],
              adjclose: [{ adjclose: [10.2] }],
            },
          },
        ],
        error: null,
      },
    });
    const parsed = parseChart(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bars[0].date).toBe('2024-01-03');
  });

  it('falls back adjClose→close for a present row whose adjClose is null (no silent drop)', () => {
    // OHLCV present but the adjclose series is null/truncated at that index: the
    // row must still be emitted (SAD-003#2.4), with adjClose == raw close.
    const body = JSON.stringify({
      chart: {
        result: [
          {
            meta: { gmtoffset: -18000 },
            timestamp: [1704205800],
            indicators: {
              quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [10] }],
              adjclose: [{ adjclose: [null] }],
            },
          },
        ],
        error: null,
      },
    });
    const parsed = parseChart(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bars).toHaveLength(1);
    expect(parsed.bars[0]).toMatchObject({ close: 1.5, adjClose: 1.5 });
  });

  it('keeps a legitimate zero value (volume 0) rather than treating it as missing', () => {
    const body = JSON.stringify({
      chart: {
        result: [
          {
            meta: { gmtoffset: -18000 },
            timestamp: [1704205800],
            indicators: {
              quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [0] }],
              adjclose: [{ adjclose: [1.4] }],
            },
          },
        ],
        error: null,
      },
    });
    const parsed = parseChart(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bars[0].volume).toBe(0);
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

  it('treats a 403 bot/throttle block as transient and retries it', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const http: HttpFetch = async () => {
      calls++;
      return calls < 2 ? { status: 403, body: '<html>Forbidden</html>' } : { status: 200, body: AAPL_BODY };
    };
    const result = await fetchTicker('AAPL', RANGE, {
      http,
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(result.ok).toBe(true); // recovered after the throttle cleared
    expect(calls).toBe(2);
    expect(sleeps).toEqual([10]);
  });

  it('reports a permanent non-2xx as http-error (not malformed) without retrying', async () => {
    const sleeps: number[] = [];
    const result = await fetchTicker('AAPL', RANGE, {
      http: respond(400, '<html>Bad Request</html>'),
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ reason: 'http-error', attempts: 1, status: 400 });
    expect(sleeps).toHaveLength(0);
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

  it('never drops tickers when given an invalid batchSize (defaults to 1)', async () => {
    const http: HttpFetch = async () => ({ status: 200, body: AAPL_BODY });
    // NaN here previously made the loop slice nothing and return [] silently.
    const results = await fetchTickers(['AAPL', 'MSFT', 'GOOG'], RANGE, {
      http,
      batchSize: Number('not-a-number'),
      sleep: async () => {},
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
