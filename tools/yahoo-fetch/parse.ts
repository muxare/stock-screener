// parse.ts — URL construction and Yahoo v8 `chart` response normalisation for
// the EOD fetcher (STORY-050, SAD-003#5.1).
//
// Pure functions only: no network, no filesystem (the caller supplies the
// response body). The fetcher performs NO corporate-action arithmetic — Yahoo's
// `adjClose` is carried through as data, kept DISTINCT from raw `close`
// (SAD-003#2.3 / ADR-004). Mapping `adjClose` → the importer's close column is
// STORY-051's ingest seam, not here.

// A single normalised daily bar. `adjClose` is Yahoo's adjusted close and is
// returned DISTINCT from raw `close`; downstream (STORY-051) maps `adjClose` →
// `bar.c`. `date` is normalised to ISO `YYYY-MM-DD` (UTC).
export interface YahooDailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

// An inclusive request window. The CLI/caller supplies `Date`s; `buildChartUrl`
// converts to the endpoint's unix-second `period1`/`period2` params.
export interface DateRange {
  from: Date;
  to: Date;
}

// Why a parse can fail, kept narrow so the run-level coverage policy
// (STORY-053) can branch on it without string-matching messages.
export type ParseFailureReason = 'not-found' | 'empty' | 'malformed';

// Result of parsing one ticker's `chart` response — a discriminated union so the
// caller must handle the failure path (no silent drop, SAD-003#2.4).
export type ParsedChart =
  | { ok: true; bars: YahooDailyBar[] }
  | { ok: false; reason: ParseFailureReason; message: string };

const DEFAULT_HOST = 'https://query1.finance.yahoo.com';

// Build the Yahoo v8 `chart` JSON URL for one ticker over a date range
// (SAD-003#8.3 / ADR-003). `period2` is bumped by a day so the `to` date is
// inclusive (the endpoint treats `period2` as an exclusive upper bound).
export function buildChartUrl(ticker: string, range: DateRange, host = DEFAULT_HOST): string {
  const period1 = Math.floor(range.from.getTime() / 1000);
  const period2 = Math.floor(range.to.getTime() / 1000) + 86400;
  const params = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval: '1d',
    events: 'div,splits',
    includeAdjustedClose: 'true',
  });
  return `${host}/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`;
}

// ---------- response shape (minimal, defensive typing) ----------

interface ChartQuote {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
}

interface ChartResult {
  meta?: { gmtoffset?: number };
  timestamp?: number[];
  indicators?: {
    quote?: ChartQuote[];
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

interface ChartEnvelope {
  chart?: {
    result?: ChartResult[] | null;
    error?: { code?: string; description?: string } | null;
  };
}

// Derive the bar's trading date from Yahoo's epoch-second timestamp. The
// timestamp is the session's market-open instant in UTC, so we shift it by the
// exchange's `gmtoffset` (from the response meta) before taking the calendar
// date — otherwise a non-US exchange whose open straddles UTC midnight (e.g.
// ASX 10:00 AEDT = 23:00 UTC the prior day) would be labelled a day early.
function isoDateFromUnix(seconds: number, gmtOffsetSeconds: number): string {
  const d = new Date((seconds + gmtOffsetSeconds) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function finite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Normalise one ticker's `chart` response body into daily bars. Yahoo pads
// non-trading slots with `null`s; such rows are skipped rather than emitted.
// A response carrying `chart.error`, no result, or unparseable JSON returns a
// structured failure (SAD-003#3.1).
export function parseChart(body: string): ParsedChart {
  let json: ChartEnvelope;
  try {
    json = JSON.parse(body) as ChartEnvelope;
  } catch {
    return { ok: false, reason: 'malformed', message: 'response body is not valid JSON' };
  }

  const chart = json.chart;
  if (!chart || typeof chart !== 'object') {
    return { ok: false, reason: 'malformed', message: 'response is missing the "chart" envelope' };
  }
  if (chart.error) {
    const { code, description } = chart.error;
    return {
      ok: false,
      reason: 'not-found',
      message: description || code || 'Yahoo returned a chart error',
    };
  }

  const result = chart.result?.[0];
  if (!result) {
    return { ok: false, reason: 'empty', message: 'response carries no chart result' };
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const gmtOffset = result.meta?.gmtoffset ?? 0;

  if (timestamps.length === 0) {
    return { ok: false, reason: 'empty', message: 'response carries no daily bars' };
  }

  const bars: YahooDailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = finite(quote.open?.[i]);
    const high = finite(quote.high?.[i]);
    const low = finite(quote.low?.[i]);
    const close = finite(quote.close?.[i]);
    const volume = finite(quote.volume?.[i]);
    // A non-trading slot pads OHLCV with nulls → skipped below. When OHLCV is
    // present but this row's adjClose is missing (truncated/null series), fall
    // back to the raw close rather than silently dropping a real trading day
    // (SAD-003#2.4); adjClose stays distinct from close wherever Yahoo gives it.
    const adj = finite(adjclose[i]);
    const adjClose = adj === null ? close : adj;

    if (open === null || high === null || low === null || close === null || volume === null || adjClose === null) {
      continue;
    }
    bars.push({
      date: isoDateFromUnix(timestamps[i], gmtOffset),
      open,
      high,
      low,
      close,
      adjClose,
      volume,
    });
  }

  if (bars.length === 0) {
    return { ok: false, reason: 'empty', message: 'response carried only null/non-trading slots' };
  }
  return { ok: true, bars };
}
