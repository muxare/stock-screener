// run.ts — orchestration for the EOD importer (STORY-031).
//
// Ties together config → CSV parsing → instrument metadata resolution → SQLite
// write, returning a structured report. Filesystem access lives here and in the
// CLI (index.ts); parse.ts stays pure and testable.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, dirname } from 'node:path';
import type { ImportConfig, Metadata } from './config.ts';
import { parseFile, normalizeTicker } from './parse.ts';
import type { ParsedBar, RowError } from './parse.ts';
import { EodDatabase } from './db.ts';
import type { InstrumentRow } from './db.ts';

export interface ImportReport {
  files: number;
  instruments: number;
  bars: number;
  skipped: number; // malformed / blank rows skipped
  errors: RowError[]; // every skipped row (the CLI prints a count + sample)
}

// Extensions a directory scan treats as EOD input. `.csv` is the canonical
// export; `.txt` covers the Stooq / Kaggle "Huge Stock Market Dataset" layout,
// where each `<ticker>.us.txt` is a plain CSV with a `.txt` extension.
const INPUT_EXTENSIONS = new Set(['.csv', '.txt']);

// Expand input paths: a directory contributes its immediate `.csv`/`.txt` files;
// a file is taken as-is (any extension). Keeps ingestion to files already on disk
// (no fetch/scrape).
export function expandInputs(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const entry of readdirSync(p).sort()) {
        if (INPUT_EXTENSIONS.has(extname(entry).toLowerCase())) files.push(join(p, entry));
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

// The filename stem, normalized like any column-supplied ticker, used as the
// ticker for the one-file-per-ticker layout when the row carries no ticker
// column/value. Applying the config's ticker normalization here is what lets the
// Stooq/Kaggle layout resolve `aapl.us.txt` → stem `aapl.us` → `AAPL` (stripSuffix
// `.us` + upper-case) purely from config, matching the column-ticker path.
function fileStem(filePath: string, config: ImportConfig): string {
  return normalizeTicker(basename(filePath, extname(filePath)), config.ticker);
}

// Load the optional side metadata file (JSON `{ "<TICKER>": { name?, sector? }}`).
// The path in config is relative to the config file's directory.
export function loadMetadata(config: ImportConfig, configPath?: string): Metadata {
  if (!config.metadataFile) return {};
  const base = configPath ? dirname(resolve(configPath)) : process.cwd();
  const path = resolve(base, config.metadataFile);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`metadata file must be a JSON object: ${path}`);
  }
  return raw as Metadata;
}

// Resolve name/sector per ticker with explicit precedence (AC):
//   sector: CSV column value → metadata file → 'Unknown'  (never silently empty)
//   name:   CSV column value → metadata file → ticker
// `seen` carries the first non-empty CSV value encountered for each ticker.
function resolveInstruments(
  tickers: Set<string>,
  seen: Map<string, { name?: string; sector?: string }>,
  metadata: Metadata,
): InstrumentRow[] {
  const out: InstrumentRow[] = [];
  for (const ticker of [...tickers].sort()) {
    const fromCsv = seen.get(ticker) ?? {};
    const fromMeta = metadata[ticker] ?? {};
    const name = fromCsv.name || fromMeta.name || ticker;
    const sector = fromCsv.sector || fromMeta.sector || 'Unknown';
    out.push({ ticker, name, sector });
  }
  return out;
}

// Run a full import: parse every input file, resolve metadata, write the DB.
export function runImport(
  inputPaths: string[],
  outPath: string,
  config: ImportConfig,
  metadata: Metadata = {},
): ImportReport {
  const files = expandInputs(inputPaths);

  const allBars: ParsedBar[] = [];
  const errors: RowError[] = [];
  const tickers = new Set<string>();
  const seen = new Map<string, { name?: string; sector?: string }>();

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const fallbackTicker = fileStem(file, config);
    const { bars, errors: fileErrors } = parseFile(text, file, config, fallbackTicker);
    for (const b of bars) {
      allBars.push(b);
      tickers.add(b.ticker);
      if (!seen.has(b.ticker)) seen.set(b.ticker, {});
      const s = seen.get(b.ticker)!;
      if (!s.name && b.name) s.name = b.name;
      if (!s.sector && b.sector) s.sector = b.sector;
    }
    errors.push(...fileErrors);
  }

  const instruments = resolveInstruments(tickers, seen, metadata);

  const db = new EodDatabase(outPath);
  try {
    db.write(instruments, allBars);
  } finally {
    db.close();
  }

  return {
    files: files.length,
    instruments: instruments.length,
    bars: allBars.length,
    skipped: errors.length,
    errors,
  };
}
