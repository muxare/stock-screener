// coverage.ts — the per-run coverage & freshness reporter + partial-failure
// policy (STORY-053, SAD-003#5.3, CAP-eod-coverage).
//
// This turns the per-ticker fetch outcomes of a run (success / structured
// failure from STORY-050, gathered by the backfill of STORY-051) into a
// FIRST-CLASS run output: a structured + printable report that names EVERY
// requested ticker as fetched or failed, with a reason per failure — never an
// aggregate that hides which names dropped (SAD-003#2.4 / SAD-003#5.3). It also
// reports COVERAGE (% of the universe fetched) and FRESHNESS (max staleness =
// newest written bar date vs the last trading day) and drives the partial-
// failure policy: the successful set is already committed by `runBackfill`
// (ADR-005), and the run exits non-zero when coverage falls below a configurable
// threshold so automation can gate on it (SAD-003#8.5 / ADR-005).
//
// Pure logic only here (no network, no `process`); the thin CLI wiring + the
// non-zero exit live in backfill.ts. The one I/O helper, `newestBarDate`, reads
// the committed DB read-only to derive freshness from the NEWEST WRITTEN bar.

import { DatabaseSync } from 'node:sqlite';
import type { FetchFailure, FetchFailureReason } from './fetch.ts';

// One requested ticker's run outcome. EVERY requested ticker gets exactly one of
// these, so a name can never be silently dropped (SAD-003#2.4). `fetched` names
// carry no reason; `failed` names always carry a reason + message.
export interface TickerOutcome {
  ticker: string;
  status: 'fetched' | 'failed';
  reason?: FetchFailureReason | 'missing'; // 'missing' = no outcome was reported (a drop)
  message?: string;
  attempts?: number;
}

// The structured run report (SAD-003#2.4). Printable form is `formatReport`.
export interface CoverageReport {
  requested: number; // distinct tickers asked for
  fetched: number; // tickers that fetched at least one bar
  failed: number; // requested − fetched (includes any silently-dropped name)
  coverage: number; // fetched / requested, a fraction in [0, 1]
  minCoverage: number; // the configured threshold, a fraction in [0, 1]
  meetsThreshold: boolean; // coverage >= minCoverage → run may exit 0 (ADR-005)
  lastTradingDay: string; // ISO YYYY-MM-DD — basis for staleness (see lastTradingDay)
  newestBarDate: string | null; // newest written bar date, or null if none were written
  maxStalenessDays: number | null; // lastTradingDay − newestBarDate in days, null if no bars
  outcomes: TickerOutcome[]; // EVERY requested ticker, fetched or failed (no drops)
  failures: FetchFailure[]; // the structured failures, carried through verbatim
}

export interface CoverageInput {
  requested: string[]; // the distinct requested universe (as `runBackfill` reports it)
  succeeded: string[]; // tickers that fetched OK
  failures: FetchFailure[]; // structured per-ticker failures (STORY-050 shape)
  newestBarDate: string | null; // newest WRITTEN bar date (read from the committed DB)
  asOf: Date; // the run's `to` date — the basis for "last trading day"
  minCoverage: number; // coverage threshold, a fraction in [0, 1]
}

const MS_PER_DAY = 86_400_000;

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// The "last trading day" used for freshness. DEFINITION (documented per the
// story): the most recent WEEKDAY on or before the run's `to` date, computed in
// UTC. We deliberately do NOT consult a live market-calendar service or a
// holiday list (out of scope / not available offline, SAD-003#8.6); weekends
// roll back to the prior Friday. The only inaccuracy is that a bar whose newest
// date precedes a market holiday can read one extra day of apparent staleness —
// a small, documented imprecision, not a silent drop.
export function lastTradingDay(asOf: Date): Date {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sun … 6 = Sat
  if (day === 6) d.setUTCDate(d.getUTCDate() - 1); // Sat → Fri
  else if (day === 0) d.setUTCDate(d.getUTCDate() - 2); // Sun → Fri
  return d;
}

// Staleness in whole days between the newest written bar and the last trading
// day. Clamped at 0: a bar dated on/after the last trading day is "fresh" (0),
// never negative.
export function stalenessDays(newestBarDate: string, lastTrading: Date): number {
  const newest = new Date(`${newestBarDate}T00:00:00Z`).getTime();
  const diff = Math.round((lastTrading.getTime() - newest) / MS_PER_DAY);
  return diff > 0 ? diff : 0;
}

// Read the newest written bar date from a committed DB (read-only), or null if
// the DB has no bars. Freshness is derived from the NEWEST WRITTEN bar
// (SAD-003#5.3), so this reflects the DB's state AFTER the run's commit. A
// missing/empty DB yields null rather than throwing, so a fully-failed run still
// produces a report.
export function newestBarDate(dbPath: string): string | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null; // no DB written (e.g. every ticker failed before any commit)
  }
  try {
    const row = db.prepare('SELECT MAX(date) AS d FROM bar').get() as unknown as { d: string | null };
    return row?.d ?? null;
  } catch {
    return null; // no `bar` table yet
  } finally {
    db.close();
  }
}

// Build the structured coverage/freshness report from a run's outcomes. Pure.
// Defensively reconciles `succeeded` + `failures` against the full `requested`
// set: a requested ticker that appears in NEITHER is surfaced as a 'missing'
// failure rather than vanishing, so a silent drop becomes a visible failure
// (SAD-003#2.4) and is counted against coverage.
export function buildCoverageReport(input: CoverageInput): CoverageReport {
  const requested = [...new Set(input.requested)];
  const succeededSet = new Set(input.succeeded);
  const failureByTicker = new Map(input.failures.map((f) => [f.ticker, f]));

  const outcomes: TickerOutcome[] = requested.map((ticker) => {
    if (succeededSet.has(ticker)) return { ticker, status: 'fetched' };
    const failure = failureByTicker.get(ticker);
    if (failure) {
      return {
        ticker,
        status: 'failed',
        reason: failure.reason,
        message: failure.message,
        attempts: failure.attempts,
      };
    }
    // Neither succeeded nor failed → it was silently dropped. Make it loud.
    return { ticker, status: 'failed', reason: 'missing', message: 'no fetch outcome was reported' };
  });

  const fetched = outcomes.filter((o) => o.status === 'fetched').length;
  const failed = requested.length - fetched;
  const coverage = requested.length === 0 ? 1 : fetched / requested.length;
  const lastTrading = lastTradingDay(input.asOf);
  const maxStalenessDays = input.newestBarDate === null ? null : stalenessDays(input.newestBarDate, lastTrading);

  return {
    requested: requested.length,
    fetched,
    failed,
    coverage,
    minCoverage: input.minCoverage,
    meetsThreshold: coverage >= input.minCoverage,
    lastTradingDay: isoDate(lastTrading),
    newestBarDate: input.newestBarDate,
    maxStalenessDays,
    outcomes,
    failures: input.failures,
  };
}

const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

// The printable form of the report — a first-class run output, not log-only
// (SAD-003#5.3). It states coverage and freshness, names EVERY failure with its
// reason, and lists the fetched names compactly so no name is hidden behind an
// aggregate (SAD-003#2.4). The threshold verdict is explicit so the operator
// sees why the run will exit non-zero.
export function formatReport(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(
    `coverage: ${report.fetched}/${report.requested} (${pct(report.coverage)}) ` +
      `— threshold ${pct(report.minCoverage)} ${report.meetsThreshold ? 'MET' : 'NOT MET'}`,
  );

  const freshness =
    report.newestBarDate === null
      ? 'freshness: no bars written (no freshness to report)'
      : `freshness: newest bar ${report.newestBarDate} vs last trading day ${report.lastTradingDay} ` +
        `— max staleness ${report.maxStalenessDays} day(s)`;
  lines.push(freshness);

  const fetched = report.outcomes.filter((o) => o.status === 'fetched').map((o) => o.ticker);
  if (fetched.length > 0) lines.push(`fetched (${fetched.length}): ${fetched.join(', ')}`);

  if (report.failed > 0) {
    lines.push(`failed (${report.failed}):`);
    for (const o of report.outcomes) {
      if (o.status !== 'failed') continue;
      const attempts = o.attempts === undefined ? '' : ` (after ${o.attempts} attempt(s))`;
      lines.push(`  ${o.ticker}: ${o.reason} — ${o.message}${attempts}`);
    }
  }

  return lines.join('\n');
}
