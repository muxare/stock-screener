// daily.ts — the daily post-close APPEND run mode (STORY-052, SAD-003#3.2 /
// SAD-003#5.2, CAP-eod-ingest). The sibling of the STORY-051 backfill.
//
// Where the backfill fetches a SUPPLIED historical range, the daily append
// fetches only what is NEW since the last stored bar per ticker and appends it
// to the EXISTING Yahoo DB through the SAME importer path — there is exactly ONE
// idempotent write path (`importResults`, the importer's ON CONFLICT(ticker,date)
// upsert), never a second DB writer (SAD-003#2.2 / SAD-003#5.2 / ADR-002).
//
// It builds NO scheduler (ADR-008 / SAD-003#8.8): this is a single-shot CLI
// invoked by an external trigger (cron / manual). Resumability is "just re-run" —
// the upsert overwrites in place, so a re-run the same day adds no duplicate rows
// and an interrupted run is recovered by running it again. Re-fetching the last
// stored day (the fetch window is INCLUSIVE of it) is deliberate: it overwrites a
// possibly-partial final bar in place and guarantees no gap opens between runs.
//
// Per-ticker "since the last stored bar" is the efficiency refinement ADR-008
// names for the daily mode: each ticker's fetch starts at its own newest stored
// date, so a name that is already current fetches only its trailing day.

import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchTickers } from './fetch.ts';
import type { BatchOptions, FetchFailure, FetchResult } from './fetch.ts';
import { DEFAULT_YAHOO_DB, YAHOO_CONFIG, importResults, loadTickers } from './backfill.ts';
import type { ImportOutcome } from './backfill.ts';
import { buildCoverageReport, formatReport, newestBarDate } from './coverage.ts';

export interface DailyAppendOptions extends BatchOptions {
  tickers: string[]; // the SUPPLIED universe — no discovery (SAD-003#1.2)
  asOf: Date; // the run's end date — the `to` of every fetch window (default: today)
  dbPath?: string; // the Yahoo DB to append to; defaults to DEFAULT_YAHOO_DB
  configPath?: string; // importer config; defaults to config.yahoo.json
}

export interface DailyAppendReport {
  dbPath: string;
  requested: number; // distinct tickers asked for
  succeeded: string[]; // tickers that fetched at least one bar
  failures: FetchFailure[]; // every failed ticker (never a silent drop)
  instruments: number; // instruments upserted by the importer
  bars: number; // bars upserted by the importer
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Read the newest stored bar date PER ticker from the committed Yahoo DB
// (read-only), so the daily run can fetch only what is new since then
// (SAD-003#8.8 / ADR-008). A missing/empty DB yields an empty map rather than
// throwing, so a first-ever run (or a run against a not-yet-created DB) still
// proceeds — every requested ticker just has no prior bar. Mirrors the read-only
// pattern of coverage.ts's `newestBarDate`, but grouped per ticker.
export function lastBarDates(dbPath: string): Map<string, string> {
  const out = new Map<string, string>();
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return out; // no DB yet — nothing stored, every ticker starts fresh
  }
  try {
    const rows = db.prepare('SELECT ticker, MAX(date) AS d FROM bar GROUP BY ticker').all() as unknown as {
      ticker: string;
      d: string | null;
    }[];
    for (const r of rows) {
      if (r.d) out.set(r.ticker, r.d);
    }
  } catch {
    // no `bar` table yet — leave the map empty
  } finally {
    db.close();
  }
  return out;
}

// The inclusive fetch window for one ticker on this run: from its last stored bar
// (so the boundary day is re-fetched and upserted in place) through `asOf`. A
// ticker with NO stored bar has no "since" anchor — daily append EXTENDS an
// existing series; seeding a new ticker's history is the backfill's job
// (STORY-051), so an unknown name simply fetches the run day (`asOf`) and lands,
// never silently dropped (SAD-003#2.4). If a ticker's newest bar is somehow ahead
// of `asOf`, clamp `from` to `asOf` so the window never inverts.
function windowFrom(lastBar: string | undefined, asOfIso: string): string {
  if (!lastBar) return asOfIso;
  return lastBar <= asOfIso ? lastBar : asOfIso;
}

// Run a daily append: fetch each supplied ticker SINCE its last stored bar, then
// upsert through the shared importer path. Tickers that share a `from` date (the
// common case — a universe kept current together) are fetched in ONE polite
// batched call, preserving the batch-size / inter-batch-delay politeness
// (SAD-003#2.7). Re-running is idempotent (the importer upserts on (ticker,date)).
export async function runDailyAppend(opts: DailyAppendOptions): Promise<DailyAppendReport> {
  const dbPath = resolve(opts.dbPath ?? DEFAULT_YAHOO_DB);
  const configPath = opts.configPath ?? YAHOO_CONFIG;
  const asOfIso = isoDate(opts.asOf);

  const tickers = [...new Set(opts.tickers)];
  const lastBars = lastBarDates(dbPath);

  // Group tickers by their computed `from` date so each distinct window is a
  // single fetchTickers call (retains polite batching within the group). Iterated
  // in insertion order — deterministic given the ticker list.
  const groups = new Map<string, string[]>();
  for (const t of tickers) {
    const from = windowFrom(lastBars.get(t), asOfIso);
    const g = groups.get(from);
    if (g) g.push(t);
    else groups.set(from, [t]);
  }

  const results: FetchResult[] = [];
  for (const [from, groupTickers] of groups) {
    const range = { from: new Date(`${from}T00:00:00Z`), to: opts.asOf };
    results.push(...(await fetchTickers(groupTickers, range, opts)));
  }

  // Funnel through the SHARED ingest tail — the same idempotent write path the
  // backfill uses (SAD-003#2.2 / ADR-002). No second DB writer.
  const outcome: ImportOutcome = importResults(results, dbPath, configPath);
  return { dbPath, requested: tickers.length, ...outcome };
}

// ---------------------------------------------------------------------------
// Thin CLI (SAD-003#5.1: thin I/O front-end over the pure seam). Server/CLI-only
// (SAD-003#2.5) — never imported by client code. Single-shot; NO scheduler
// (SAD-003#8.8 / ADR-008) — the trigger (cron / manual) is external.
// ---------------------------------------------------------------------------

interface CliArgs {
  asOf: Date;
  tickers: string[];
  dbPath?: string;
  batchSize?: number;
  delayMs?: number;
  minCoverage: number;
}

// Match the backfill's conservative default: 1.0 means ANY failed/dropped ticker
// makes the run exit non-zero (SAD-003#8.5 / ADR-005, SAD-003#2.4).
const DEFAULT_MIN_COVERAGE = 1.0;

function parseIsoDate(raw: string, flag: string): Date {
  const s = (raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`${flag} must be an ISO date (YYYY-MM-DD), got "${raw}"`);
  const [y, mo, day] = [+m[1], +m[2], +m[3]];
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) {
    throw new Error(`${flag} is not a valid calendar date: "${raw}"`);
  }
  return d;
}

function parseIntFlag(raw: string | undefined, flag: string, min: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${flag} must be an integer >= ${min}, got "${raw}"`);
  return n;
}

function parseFractionFlag(raw: string | undefined, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${flag} must be a number in [0, 1], got "${raw}"`);
  return n;
}

// Today's calendar date in UTC — the default `asOf`. Reading wall-clock time
// lives HERE in the CLI I/O front-end, never in the engine or the pure seam
// (SAD-003#2.6): the engine sees no "today". Override with --as-of for a
// deterministic run (tests, or re-running a specific session).
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseArgs(argv: string[]): CliArgs {
  let asOf: Date | undefined;
  let dbPath: string | undefined;
  let batchSize: number | undefined;
  let delayMs: number | undefined;
  let minCoverage = DEFAULT_MIN_COVERAGE;
  const tickers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--as-of' || a === '-a') asOf = parseIsoDate(argv[++i], '--as-of');
    else if (a === '--out' || a === '-o') dbPath = argv[++i];
    else if (a === '--tickers' || a === '-T') tickers.push(...loadTickers(argv[++i]));
    else if (a === '--batch-size' || a === '-b') batchSize = parseIntFlag(argv[++i], '--batch-size', 1);
    else if (a === '--delay-ms' || a === '-d') delayMs = parseIntFlag(argv[++i], '--delay-ms', 0);
    else if (a === '--min-coverage' || a === '-c') minCoverage = parseFractionFlag(argv[++i], '--min-coverage');
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    else tickers.push(a.toUpperCase());
  }
  if (tickers.length === 0) throw new Error('at least one ticker (positional or via --tickers <file>) is required');
  return { asOf: asOf ?? today(), tickers, dbPath, batchSize, delayMs, minCoverage };
}

function printUsage(): void {
  process.stdout.write(
    'Yahoo EOD daily append → existing importer → SQLite (server/CLI-only, single-shot)\n\n' +
      'Fetches each ticker SINCE its last stored bar and appends to the Yahoo DB.\n' +
      'No scheduler — invoke from cron or by hand; re-running is idempotent.\n\n' +
      'Usage:\n' +
      '  node tools/yahoo-fetch/daily.ts <TICKER> [...]\n' +
      '  node tools/yahoo-fetch/daily.ts --tickers <file> [--as-of YYYY-MM-DD]\n\n' +
      'Options:\n' +
      '  -a, --as-of       run date (inclusive upper bound), ISO YYYY-MM-DD (default: today, UTC)\n' +
      '  -T, --tickers     file with one ticker per line (# comments allowed)\n' +
      `  -o, --out         Yahoo SQLite DB to append to (default ${DEFAULT_YAHOO_DB})\n` +
      '  -b, --batch-size  tickers fetched concurrently per batch (default 1)\n' +
      '  -d, --delay-ms    inter-batch delay in ms (default 0)\n' +
      `  -c, --min-coverage  exit non-zero below this coverage fraction [0,1] (default ${DEFAULT_MIN_COVERAGE})\n` +
      '  -h, --help        show this help\n',
  );
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n`);
    printUsage();
    process.exit(2);
    return;
  }

  const report = await runDailyAppend({
    tickers: args.tickers,
    asOf: args.asOf,
    dbPath: args.dbPath,
    batchSize: args.batchSize,
    delayMs: args.delayMs,
  });

  process.stdout.write(
    `appended ${report.bars} bars across ${report.instruments} instruments ` +
      `(${report.succeeded.length}/${report.requested} tickers) → ${report.dbPath}\n`,
  );

  // The coverage/freshness report is a FIRST-CLASS run output (SAD-003#5.3): the
  // successful set is already committed by runDailyAppend; here we build and PRINT
  // the report — naming every fetched and every failed ticker so no name is hidden
  // (SAD-003#2.4) — and derive freshness from the newest WRITTEN bar vs the last
  // trading day. The run exits non-zero only when coverage falls below
  // --min-coverage, so automation can gate on it (SAD-003#8.5 / ADR-005).
  const coverage = buildCoverageReport({
    requested: report.succeeded.concat(report.failures.map((f) => f.ticker)),
    succeeded: report.succeeded,
    failures: report.failures,
    newestBarDate: newestBarDate(report.dbPath),
    asOf: args.asOf,
    minCoverage: args.minCoverage,
  });
  process.stdout.write(formatReport(coverage) + '\n');
  if (!coverage.meetsThreshold) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
