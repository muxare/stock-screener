// index.ts — the portfolio backfill's command line.
//
//   npm run portfolio:backfill -- <folder> [--out <folder>] [--poll <seconds>]
//
// Reads every image in the folder, submits them as one batch, waits, and writes
// one JSON file per screenshot beside a summary. Everything it writes is a
// proposal for a human to read: see the header of `backfill.ts` for why this
// tool does not confirm anything itself.
//
// ESM note (this repo is `"type": "module"`): `__dirname` is undefined, so
// script-relative paths come from `import.meta.dirname` and the folder the user
// named is resolved against the working directory.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { sqliteProvider } from '../../src/lib/data/sqlite.ts';
import { apiBatchPort, isImageMediaType, runBackfill } from './backfill.ts';
import type { BatchItem } from './backfill.ts';
import type { BarLookup } from '../../server/claude/portfolio/validate.ts';

const MEDIA_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function usage(message: string): never {
  console.error(`${message}

usage: npm run portfolio:backfill -- <folder> [--out <folder>] [--poll <seconds>]

  <folder>        screenshots to read (png, jpg, gif, webp)
  --out <folder>  where to write the results (default: <folder>/extracted)
  --poll <secs>   seconds between status checks (default: 30)

  MARKETDATA_DB, when set, is opened read-only so an average price can be
  checked against what the instrument has actually traded at. Without it the
  arithmetic checks still run and the price check is skipped.`);
  process.exit(1);
}

function readArgs(argv: string[]) {
  const positional: string[] = [];
  let out: string | null = null;
  let pollSeconds = 30;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') { out = argv[++i] ?? usage('--out needs a folder'); }
    else if (arg === '--poll') {
      const raw = argv[++i] ?? usage('--poll needs a number of seconds');
      pollSeconds = Number(raw);
      if (!Number.isFinite(pollSeconds) || pollSeconds < 1) usage(`--poll must be a positive number, got "${raw}"`);
    } else if (arg.startsWith('-')) usage(`unknown option "${arg}"`);
    else positional.push(arg);
  }
  if (positional.length !== 1) usage('name exactly one folder of screenshots');
  return { dir: resolve(positional[0]), out, pollSeconds };
}

function readScreenshots(dir: string): BatchItem[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    usage(`cannot read the folder ${dir}`);
  }
  const items: BatchItem[] = [];
  for (const name of names.sort()) {
    const mediaType = MEDIA_BY_EXTENSION[extname(name).toLowerCase()];
    if (!mediaType || !isImageMediaType(mediaType)) continue;
    items.push({
      // The file's name is the custom_id, so results are keyed by the screenshot
      // they came from rather than by the order the API happened to finish in.
      customId: name,
      mediaType,
      dataBase64: readFileSync(join(dir, name)).toString('base64'),
    });
  }
  return items;
}

/** The universe to check prices against, when one is configured. */
function barLookup(): BarLookup {
  const db = process.env.MARKETDATA_DB;
  if (!db) return { getInstrument: () => null };
  try {
    return sqliteProvider(resolve(db));
  } catch (err) {
    console.error(`warning: could not open MARKETDATA_DB (${(err as Error).message}); price checks are skipped`);
    return { getInstrument: () => null };
  }
}

async function main(): Promise<void> {
  const { dir, out, pollSeconds } = readArgs(process.argv.slice(2));
  const outDir = out ? resolve(out) : join(dir, 'extracted');

  const items = readScreenshots(dir);
  if (items.length === 0) usage(`no images in ${dir}`);

  // `new Anthropic()` resolves ANTHROPIC_API_KEY or an `ant auth login` profile;
  // a key is never read or printed here.
  const port = apiBatchPort(new Anthropic());

  const report = await runBackfill(items, port, barLookup(), {
    pollMs: pollSeconds * 1000,
    onProgress: (message) => console.log(message),
  });

  mkdirSync(outDir, { recursive: true });
  for (const outcome of report.outcomes) {
    writeFileSync(join(outDir, `${outcome.customId}.json`), `${JSON.stringify(outcome, null, 2)}\n`);
  }
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n${report.succeeded} of ${report.submitted} screenshot(s) read cleanly; results in ${outDir}`);
  for (const outcome of report.outcomes) {
    if (outcome.ok) continue;
    console.log(`  ${outcome.customId}: ${outcome.failure ?? outcome.problems.join('; ')}`);
  }
  // Nothing here is confirmed. Review the files before believing a number.
}

try {
  await main();
} catch (err) {
  // A stack trace is the wrong answer to "the API rejected the request": the
  // operator needs the sentence, and the SDK puts the useful part in `message`.
  console.error(`\nbackfill failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
