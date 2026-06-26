// index.ts — CLI for the EOD CSV → SQLite importer (STORY-031).
//
// DEV/TEST TOOLING ONLY (SAD#1.2 / SAD#8.7). Ingests end-of-day OHLCV CSV files
// already on disk into a SQLite DB shaped per SAD#6.1, so dev/test can run on
// real-shaped historical data instead of the synthetic generator. It does NOT
// fetch/scrape, and performs NO corporate-action adjustment: bars are TRUSTED as
// pre-adjusted (SAD#2.2 / ADR-005 stay with the vendor adapter, STORY-015).
//
// Usage:
//   node tools/eod-import/index.ts --config <config.json> --out <db path> <csv|dir> [...]
//
// The read side is STORY-032's sqliteProvider; this tool only writes.

import { loadConfig } from './config.ts';
import { loadMetadata, runImport } from './run.ts';

interface CliArgs {
  configPath: string;
  outPath: string;
  inputs: string[];
}

function parseArgs(argv: string[]): CliArgs {
  let configPath = '';
  let outPath = '';
  const inputs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') configPath = argv[++i];
    else if (a === '--out' || a === '-o') outPath = argv[++i];
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    else inputs.push(a);
  }
  if (!configPath) throw new Error('--config <config.json> is required');
  if (!outPath) throw new Error('--out <db path> is required');
  if (inputs.length === 0) throw new Error('at least one input CSV file or directory is required');
  return { configPath, outPath, inputs };
}

function printUsage(): void {
  process.stdout.write(
    'EOD CSV → SQLite importer (dev/test tooling)\n\n' +
      'Usage:\n' +
      '  node tools/eod-import/index.ts --config <config.json> --out <db path> <csv|dir> [...]\n\n' +
      'Options:\n' +
      '  -c, --config  JSON config: column mapping, date format, ticker normalization\n' +
      '  -o, --out     output SQLite DB path\n' +
      '  -h, --help    show this help\n',
  );
}

function main(): void {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n\n`);
    printUsage();
    process.exit(2);
  }

  const config = loadConfig(args.configPath);
  const metadata = loadMetadata(config, args.configPath);

  const started = Date.now();
  const report = runImport(args.inputs, args.outPath, config, metadata);
  const elapsedMs = Date.now() - started;

  process.stdout.write(
    `imported ${report.bars} bars across ${report.instruments} instruments ` +
      `from ${report.files} file(s) → ${args.outPath} in ${(elapsedMs / 1000).toFixed(2)}s\n`,
  );

  if (report.skipped > 0) {
    process.stdout.write(`skipped ${report.skipped} malformed/blank row(s):\n`);
    const sample = report.errors.slice(0, 10);
    for (const e of sample) {
      process.stdout.write(`  ${e.file}:${e.line}  ${e.reason}` + (e.sample ? `  | ${e.sample}` : '') + '\n');
    }
    if (report.skipped > sample.length) {
      process.stdout.write(`  … and ${report.skipped - sample.length} more\n`);
    }
  }
}

main();
