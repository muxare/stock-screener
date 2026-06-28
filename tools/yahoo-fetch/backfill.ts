// backfill.ts — the fetch → import seam (STORY-051, SAD-003#5.2, CAP-eod-ingest).
//
// Given a SUPPLIED ticker list + a historical range, this fetches each ticker via
// the STORY-050 primitive (fetch.ts), NORMALISES the successful rows into the
// importer's CSV input shape, and runs the EXISTING importer (tools/eod-import +
// config.yahoo.json) to land them in the SAD-001#6.1 `instrument`/`bar` schema.
//
// Per ADR-002 (SAD-003#8.2) the seam EMITS THE IMPORTER'S CSV and invokes the
// importer's public `runImport` — it never calls the importer's `db.ts` writer
// directly, so there is exactly ONE idempotent write path (the importer's
// ON CONFLICT(ticker,date) upsert, SAD-003#2.2). Adjusted close reaches the
// engine because `adjClose` is written into the CSV's mapped `close` column, so
// `bar.c ← adjClose`; raw o/h/l/v are carried through verbatim with NO
// corporate-action arithmetic (SAD-003#6.1, SAD-003#8.4 / ADR-004).
//
// The written DB is served unchanged by STORY-032's `sqliteProvider`: point
// MARKETDATA_DB at it and the app/screen runs exactly as against synthetic
// (SAD-003#2.1). The HTTP layer is injectable so tests run against recorded
// fixtures with no live network (SAD-003#8.6 / ADR-006).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchTickers } from './fetch.ts';
import type { BatchOptions, FetchFailure, FetchResult } from './fetch.ts';
import type { DateRange, YahooDailyBar } from './parse.ts';
import { loadConfig } from '../eod-import/config.ts';
import { loadMetadata, runImport } from '../eod-import/run.ts';
import { buildCoverageReport, formatReport, newestBarDate } from './coverage.ts';

// The default Yahoo-sourced DB: a STABLE, DOCUMENTED path at the repo root,
// DISTINCT from the synthetic generator (which has no file) and from the EOD
// dev-import default (`dev-market.db`) and golden-master fixtures (SAD-003#6.2).
// It is gitignored (`*.db`) and selectable via MARKETDATA_DB like any dev DB.
export const DEFAULT_YAHOO_DB = resolve(import.meta.dirname, '..', '..', 'yahoo-market.db');

// The importer config that maps the emitted CSV's shape (Company ticker column,
// `iso` dates, ignored Dividends/Stock Splits) and points at the metadata side
// file for name/sector resolution. Reused verbatim — not forked (SAD-003#5.2).
const YAHOO_CONFIG = resolve(import.meta.dirname, '..', 'eod-import', 'config.yahoo.json');

// The CSV columns config.yahoo.json maps, in a stable header order. Names must
// match `config.yahoo.json.columns`; the importer maps by name, not position.
const CSV_HEADER = 'Company,Date,Open,High,Low,Close,Volume';

export interface BackfillOptions extends BatchOptions {
  tickers: string[]; // the SUPPLIED universe — no discovery (SAD-003#1.2)
  range: DateRange; // the historical window to backfill
  dbPath?: string; // output DB; defaults to DEFAULT_YAHOO_DB
  configPath?: string; // importer config; defaults to config.yahoo.json
}

export interface BackfillReport {
  dbPath: string;
  requested: number; // tickers asked for
  succeeded: string[]; // tickers that fetched at least one bar
  failures: FetchFailure[]; // every failed ticker, never silently dropped (SAD-003#2.4)
  instruments: number; // instruments written by the importer
  bars: number; // bars written by the importer
}

// Normalise the fetcher's successful results into the importer's CSV input
// (ADR-002). KEY MAPPING: the CSV's `Close` column carries Yahoo's `adjClose`,
// so the importer writes `bar.c ← adjClose` (SAD-003#6.1). Raw open/high/low and
// volume are carried through unchanged — NO corporate-action math here. Failed
// tickers contribute no rows (they are reported by the caller, not dropped).
export function toImporterCsv(results: FetchResult[]): string {
  const lines: string[] = [CSV_HEADER];
  for (const r of results) {
    if (!r.ok) continue;
    for (const b of r.bars) {
      lines.push(csvRow(r.ticker, b));
    }
  }
  return lines.join('\n') + '\n';
}

function csvRow(ticker: string, b: YahooDailyBar): string {
  // adjClose → the Close column (→ bar.c); raw o/h/l/v verbatim (SAD-003#6.1).
  return [ticker, b.date, b.open, b.high, b.low, b.adjClose, b.volume].join(',');
}

// Load a supplied ticker list from a file: one ticker per line, `#` comments and
// blank lines ignored, upper-cased. The set of tickers is always SUPPLIED — this
// tool does no universe discovery (SAD-003#1.2).
export function loadTickers(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const tickers: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    tickers.push(line.toUpperCase());
  }
  return tickers;
}

// Run a historical backfill: fetch every supplied ticker over `range`, normalise
// the successful set to the importer's CSV, and run the existing importer to
// write/upsert the DB. Re-running is idempotent (the importer upserts on
// (ticker,date)). Returns a report; the run-level coverage threshold / exit
// policy is STORY-053, out of scope here (SAD-003#3.3).
export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const dbPath = resolve(opts.dbPath ?? DEFAULT_YAHOO_DB);
  const configPath = opts.configPath ?? YAHOO_CONFIG;

  // De-duplicate the supplied list (positional + --tickers file can repeat a
  // name): each ticker is fetched once, and `requested`/`succeeded` reflect
  // distinct names rather than double-counting. The importer upsert would dedupe
  // the DB regardless, but the run report should not over-report.
  const tickers = [...new Set(opts.tickers)];
  const results = await fetchTickers(tickers, opts.range, opts);

  const csv = toImporterCsv(results);
  const failures = results.filter((r): r is Extract<FetchResult, { ok: false }> => !r.ok).map((r) => r.failure);
  const succeeded = results.filter((r) => r.ok).map((r) => r.ticker);

  // Emit the CSV to a throwaway working file, then run the EXISTING importer over
  // it with config.yahoo.json (which resolves name/sector via its metadata file →
  // default precedence). The CSV is intermediate, so it lives in a temp dir, not
  // the repo. We never touch db.ts directly (ADR-002).
  const config = loadConfig(configPath);
  const metadata = loadMetadata(config, configPath);

  const workDir = mkdtempSync(join(tmpdir(), 'yahoo-backfill-'));
  const csvPath = join(workDir, 'yahoo-export.csv');
  try {
    writeFileSync(csvPath, csv, 'utf8');
    const report = runImport([csvPath], dbPath, config, metadata);
    return {
      dbPath,
      requested: tickers.length,
      succeeded,
      failures,
      instruments: report.instruments,
      bars: report.bars,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Thin CLI (SAD-003#5.1: thin I/O front-end over the pure seam). Server/CLI-only
// (SAD-003#2.5) — never imported by client code.
// ---------------------------------------------------------------------------

interface CliArgs {
  from: Date;
  to: Date;
  tickers: string[];
  dbPath?: string;
  batchSize?: number;
  delayMs?: number;
  minCoverage: number; // STORY-053 threshold; defaults to DEFAULT_MIN_COVERAGE
}

// Default coverage threshold (a fraction): 1.0 means ANY failed/dropped ticker
// makes the run exit non-zero (SAD-003#8.5 / ADR-005) — the conservative default
// for "a run that silently drops names is a failure" (SAD-003#2.4). Loosen with
// --min-coverage for a large universe where a few delisted names are tolerable.
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

// Parse the coverage threshold as a fraction in [0, 1], rejecting garbage so a
// bad value never silently disables the gate.
function parseFractionFlag(raw: string | undefined, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${flag} must be a number in [0, 1], got "${raw}"`);
  return n;
}

function parseArgs(argv: string[]): CliArgs {
  let from: Date | undefined;
  let to: Date | undefined;
  let dbPath: string | undefined;
  let batchSize: number | undefined;
  let delayMs: number | undefined;
  let minCoverage = DEFAULT_MIN_COVERAGE;
  const tickers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from' || a === '-f') from = parseIsoDate(argv[++i], '--from');
    else if (a === '--to' || a === '-t') to = parseIsoDate(argv[++i], '--to');
    else if (a === '--out' || a === '-o') dbPath = argv[++i];
    else if (a === '--tickers' || a === '-T') tickers.push(...loadTickers(argv[++i]));
    else if (a === '--batch-size' || a === '-b') batchSize = parseIntFlag(argv[++i], '--batch-size', 1);
    else if (a === '--delay-ms' || a === '-d') delayMs = parseIntFlag(argv[++i], '--delay-ms', 0);
    else if (a === '--min-coverage' || a === '-c') minCoverage = parseFractionFlag(argv[++i], '--min-coverage');
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    else tickers.push(a.toUpperCase());
  }
  if (!from) throw new Error('--from <YYYY-MM-DD> is required');
  if (!to) throw new Error('--to <YYYY-MM-DD> is required');
  if (tickers.length === 0) throw new Error('at least one ticker (positional or via --tickers <file>) is required');
  return { from, to, tickers, dbPath, batchSize, delayMs, minCoverage };
}

function printUsage(): void {
  process.stdout.write(
    'Yahoo EOD backfill → existing importer → SQLite (server/CLI-only)\n\n' +
      'Usage:\n' +
      '  node tools/yahoo-fetch/backfill.ts --from <YYYY-MM-DD> --to <YYYY-MM-DD> <TICKER> [...]\n' +
      '  node tools/yahoo-fetch/backfill.ts --from <YYYY-MM-DD> --to <YYYY-MM-DD> --tickers <file>\n\n' +
      'Options:\n' +
      '  -f, --from        start date (inclusive), ISO YYYY-MM-DD\n' +
      '  -t, --to          end date (inclusive), ISO YYYY-MM-DD\n' +
      '  -T, --tickers     file with one ticker per line (# comments allowed)\n' +
      `  -o, --out         output SQLite DB (default ${DEFAULT_YAHOO_DB})\n` +
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

  const report = await runBackfill({
    tickers: args.tickers,
    range: { from: args.from, to: args.to },
    dbPath: args.dbPath,
    batchSize: args.batchSize,
    delayMs: args.delayMs,
  });

  process.stdout.write(
    `imported ${report.bars} bars across ${report.instruments} instruments ` +
      `(${report.succeeded.length}/${report.requested} tickers) → ${report.dbPath}\n`,
  );

  // The coverage/freshness report is a FIRST-CLASS run output (SAD-003#5.3): the
  // successful set is already committed by runBackfill (ADR-005); here we build
  // and PRINT the report — naming every fetched and every failed ticker so no
  // name is hidden (SAD-003#2.4) — and derive freshness from the newest WRITTEN
  // bar in the committed DB vs the last trading day. The run exits non-zero only
  // when coverage falls below --min-coverage, so automation can gate on it
  // (SAD-003#8.5 / ADR-005).
  const coverage = buildCoverageReport({
    requested: report.succeeded.concat(report.failures.map((f) => f.ticker)),
    succeeded: report.succeeded,
    failures: report.failures,
    newestBarDate: newestBarDate(report.dbPath),
    asOf: args.to,
    minCoverage: args.minCoverage,
  });
  process.stdout.write(formatReport(coverage) + '\n');
  if (!coverage.meetsThreshold) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
