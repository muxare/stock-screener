// index.ts — CLI for the Yahoo EOD fetcher (STORY-050, SAD-003#5.1).
//
// SERVER/CLI-ONLY (SAD-003#2.5): all network I/O lives here and in fetch.ts; this
// module must never enter the client bundle, and it checks in no secret. It is
// the thin I/O front-end over the pure fetch primitive — it fetches one or more
// tickers' daily bars over a date range from the Yahoo v8 `chart` endpoint and
// prints the normalised rows as JSON.
//
// The ingest seam (normalise → importer CSV → SQLite) is STORY-051; the
// universe run modes (backfill/daily) and coverage/threshold exit are
// STORY-052/053. This CLI just surfaces results and failures.
//
// Usage:
//   node tools/yahoo-fetch/index.ts --from 2024-01-01 --to 2024-02-01 AAPL MSFT

import { fetchTickers } from './fetch.ts';
import type { FetchResult } from './fetch.ts';

interface CliArgs {
  from: Date;
  to: Date;
  tickers: string[];
  batchSize?: number;
  delayMs?: number;
}

function parseIsoDate(raw: string, flag: string): Date {
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`${flag} must be an ISO date (YYYY-MM-DD), got "${raw}"`);
  const [y, mo, day] = [+m[1], +m[2], +m[3]];
  const d = new Date(`${s}T00:00:00Z`);
  // Reject impossible calendar dates: `new Date('2024-02-30…')` rolls over to
  // Mar 1 rather than failing, which would silently shift the fetch window.
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== mo - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`${flag} is not a valid calendar date: "${raw}"`);
  }
  return d;
}

// Parse an integer CLI flag, rejecting NaN/garbage so a bad value never reaches
// the fetch loop (where a non-numeric batch size would otherwise no-op).
function parseIntFlag(raw: string | undefined, flag: string, min: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${flag} must be an integer >= ${min}, got "${raw}"`);
  }
  return n;
}

function parseArgs(argv: string[]): CliArgs {
  let from: Date | undefined;
  let to: Date | undefined;
  let batchSize: number | undefined;
  let delayMs: number | undefined;
  const tickers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from' || a === '-f') from = parseIsoDate(argv[++i], '--from');
    else if (a === '--to' || a === '-t') to = parseIsoDate(argv[++i], '--to');
    else if (a === '--batch-size' || a === '-b') batchSize = parseIntFlag(argv[++i], '--batch-size', 1);
    else if (a === '--delay-ms' || a === '-d') delayMs = parseIntFlag(argv[++i], '--delay-ms', 0);
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    else tickers.push(a.toUpperCase());
  }
  if (!from) throw new Error('--from <YYYY-MM-DD> is required');
  if (!to) throw new Error('--to <YYYY-MM-DD> is required');
  if (tickers.length === 0) throw new Error('at least one ticker is required');
  return { from, to, tickers, batchSize, delayMs };
}

function printUsage(): void {
  process.stdout.write(
    'Yahoo EOD fetcher (server/CLI-only)\n\n' +
      'Usage:\n' +
      '  node tools/yahoo-fetch/index.ts --from <YYYY-MM-DD> --to <YYYY-MM-DD> <TICKER> [...]\n\n' +
      'Options:\n' +
      '  -f, --from        start date (inclusive), ISO YYYY-MM-DD\n' +
      '  -t, --to          end date (inclusive), ISO YYYY-MM-DD\n' +
      '  -b, --batch-size  tickers fetched concurrently per batch (default 1)\n' +
      '  -d, --delay-ms    inter-batch delay in ms (default 0)\n' +
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

  const results = await fetchTickers(args.tickers, { from: args.from, to: args.to }, {
    batchSize: args.batchSize,
    delayMs: args.delayMs,
  });

  // The full structured result (success bars + every failure) goes to stdout as
  // JSON so callers/STORY-051+ can consume it.
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');

  // Failures are surfaced loudly to stderr — never silently dropped
  // (SAD-003#2.4). The run-level threshold/exit policy is STORY-053; here a
  // non-zero exit simply signals that some ticker failed.
  const failures = results.filter((r): r is Extract<FetchResult, { ok: false }> => !r.ok);
  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} of ${results.length} ticker(s) failed:\n`);
    for (const f of failures) {
      process.stderr.write(`  ${f.ticker}: ${f.failure.reason} — ${f.failure.message} (after ${f.failure.attempts} attempt(s))\n`);
    }
    process.exitCode = 1;
  }
}

main();
