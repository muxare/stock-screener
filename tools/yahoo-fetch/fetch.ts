// fetch.ts — the per-ticker Yahoo EOD fetch primitive (STORY-050, SAD-003#5.1).
//
// All network I/O lives here; the HTTP layer is INJECTABLE so tests run against
// recorded fixtures with no live network call in CI (SAD-003#8.6 / ADR-006).
// Politeness against the unofficial endpoint (SAD-003#2.7): a bounded
// retry/backoff on transient failures, plus a configurable batch size and
// inter-request delay for the multi-ticker helper. A ticker that ultimately
// fails surfaces a structured failure — it is never silently dropped
// (SAD-003#2.4); that failure shape is consumed by STORY-051/053.

import { buildChartUrl, parseChart } from './parse.ts';
import type { DateRange, YahooDailyBar } from './parse.ts';

// The injectable HTTP seam. The default (`nodeFetch`) uses Node's built-in
// `fetch`; tests pass a function returning recorded fixture bodies.
export interface HttpResponse {
  status: number;
  body: string;
}
export type HttpFetch = (url: string) => Promise<HttpResponse>;

// Why a ticker fetch failed. Narrow and exported so STORY-051/053 can branch on
// the reason without parsing the message. `transient` reasons were retried up to
// the bound before giving up; `not-found`/`empty`/`malformed` are permanent.
export type FetchFailureReason =
  | 'network-error' // fetch threw (DNS/connection) — transient
  | 'http-error' // a transient HTTP status (429/5xx) that exhausted retries
  | 'not-found' // Yahoo returned a chart error (unknown/delisted symbol)
  | 'empty' // a valid response with no usable bars
  | 'malformed'; // a permanent HTTP status, or an unparseable body

// The structured per-ticker failure. Consumed by the run-level coverage policy
// (STORY-053) and the ingest seam (STORY-051); never discard a ticker silently.
export interface FetchFailure {
  ticker: string;
  reason: FetchFailureReason;
  message: string;
  attempts: number; // how many HTTP attempts were made before surfacing
  status?: number; // the last HTTP status, when there was one
}

// A per-ticker outcome — a discriminated union forcing the caller to handle the
// failure branch (SAD-003#2.4).
export type FetchResult =
  | { ok: true; ticker: string; bars: YahooDailyBar[] }
  | { ok: false; ticker: string; failure: FetchFailure };

export interface FetchOptions {
  http?: HttpFetch; // injectable HTTP; defaults to nodeFetch
  host?: string; // override the Yahoo host (tests/smoke)
  maxAttempts?: number; // bounded total tries on transient failure (default 3)
  baseDelayMs?: number; // exponential backoff base, ms (default 500)
  sleep?: (ms: number) => Promise<void>; // injectable wait (tests record calls)
}

// Polite multi-ticker fetch on top of the single-ticker primitive.
export interface BatchOptions extends FetchOptions {
  batchSize?: number; // tickers fetched concurrently per batch (default 1)
  delayMs?: number; // inter-batch delay, ms (default 0)
}

// Transient HTTP statuses worth retrying; everything else non-2xx is permanent.
// 403 is included because Yahoo's unofficial endpoint returns it for bot/rate
// throttling (the User-Agent on nodeFetch is the first line of defence, backoff
// the second), not just for hard authorization failures.
const TRANSIENT_STATUS = new Set([403, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Default HTTP via Node's built-in `fetch` — no third-party Yahoo wrapper
// (SAD-003#8.3 / ADR-003). A browser-like User-Agent avoids Yahoo's bot 403/429.
export const nodeFetch: HttpFetch = async (url) => {
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  return { status: res.status, body: await res.text() };
};

function backoffMs(base: number, attempt: number): number {
  // Exponential: base, 2·base, 4·base … keyed on the attempt just completed.
  return base * 2 ** (attempt - 1);
}

// Fetch one ticker's daily bars over a date range, with bounded retry/backoff on
// transient failures. Permanent failures (not-found / malformed) surface
// immediately without retrying.
export async function fetchTicker(
  ticker: string,
  range: DateRange,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const http = opts.http ?? nodeFetch;
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  const url = buildChartUrl(ticker, range, opts.host);

  let lastFailure: FetchFailure | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: HttpResponse;
    try {
      res = await http(url);
    } catch (e) {
      // Network-level error → transient; back off and retry within the bound.
      lastFailure = {
        ticker,
        reason: 'network-error',
        message: (e as Error).message || 'network request failed',
        attempts: attempt,
      };
      if (attempt < maxAttempts) {
        await sleep(backoffMs(baseDelayMs, attempt));
        continue;
      }
      return { ok: false, ticker, failure: lastFailure };
    }

    if (TRANSIENT_STATUS.has(res.status)) {
      lastFailure = {
        ticker,
        reason: 'http-error',
        message: `transient HTTP ${res.status}`,
        attempts: attempt,
        status: res.status,
      };
      if (attempt < maxAttempts) {
        await sleep(backoffMs(baseDelayMs, attempt));
        continue;
      }
      return { ok: false, ticker, failure: lastFailure };
    }

    if (res.status < 200 || res.status >= 300) {
      // A non-transient non-2xx, not retried. Yahoo's 404 still carries a
      // chart.error body, so surface that as 'not-found'; any other status is
      // an 'http-error' keyed on the status — never 'malformed', which would
      // misreport (e.g.) an HTML error page as a JSON parse failure.
      const parsed = parseChart(res.body);
      const failure: FetchFailure =
        !parsed.ok && parsed.reason === 'not-found'
          ? { ticker, reason: 'not-found', message: parsed.message, attempts: attempt, status: res.status }
          : { ticker, reason: 'http-error', message: `HTTP ${res.status}`, attempts: attempt, status: res.status };
      return { ok: false, ticker, failure };
    }

    // 2xx — parse the body. Parse failures here are permanent (not retried).
    const parsed = parseChart(res.body);
    if (parsed.ok) {
      return { ok: true, ticker, bars: parsed.bars };
    }
    return {
      ok: false,
      ticker,
      failure: { ticker, reason: parsed.reason, message: parsed.message, attempts: attempt, status: res.status },
    };
  }

  // Unreachable in practice (the loop returns on the final attempt); kept as a
  // total-function fallback.
  return {
    ok: false,
    ticker,
    failure: lastFailure ?? { ticker, reason: 'network-error', message: 'no attempt was made', attempts: 0 },
  };
}

// Fetch many tickers politely: at most `batchSize` concurrent requests, with an
// `delayMs` pause between batches. Each ticker yields its own FetchResult so no
// name is dropped (SAD-003#2.4). Universe-level run modes (backfill range vs
// daily-since-last) are STORY-051/052; this is only the polite batching seam.
export async function fetchTickers(
  tickers: string[],
  range: DateRange,
  opts: BatchOptions = {},
): Promise<FetchResult[]> {
  // Guard the loop controls against NaN/garbage: an invalid batchSize must never
  // make the loop slice nothing and drop every ticker (SAD-003#2.4).
  const batchSize =
    Number.isFinite(opts.batchSize) && (opts.batchSize as number) >= 1 ? Math.floor(opts.batchSize as number) : 1;
  const delayMs = Number.isFinite(opts.delayMs) && (opts.delayMs as number) > 0 ? (opts.delayMs as number) : 0;
  const sleep = opts.sleep ?? defaultSleep;

  const results: FetchResult[] = [];
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((t) => fetchTicker(t, range, opts)));
    results.push(...batchResults);
    if (delayMs > 0 && i + batchSize < tickers.length) {
      await sleep(delayMs);
    }
  }
  return results;
}
