// devImport.ts — dev-only EOD import endpoint backing (STORY-031 in the UI).
//
// DEV/TEST TOOLING ONLY (SAD#1.2 / SAD#8.7). Surfaces the CLI EOD importer
// (tools/eod-import) inside the running screener so a developer can load CSV
// dev/test data from the UI instead of dropping to a shell. It is gated behind
// the DEV_TOOLS env flag and the routes are only registered when that flag is
// on (server/index.ts), so it cannot exist in a production deployment.
//
// The importer itself is unchanged: this module only resolves the request
// (which config, which input files, which target DB), delegates to runImport,
// then hot-reloads the warm universe (universe.ts `reload`) so the freshly
// imported data is screened immediately — no process restart.

import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMetadata, runImport } from '../tools/eod-import/run.ts';
import { loadConfig, normalizeConfig } from '../tools/eod-import/config.ts';
import type { ImportConfig } from '../tools/eod-import/config.ts';
import { sqliteProvider } from '../src/lib/data/sqlite.ts';
import { RequestError } from './handlers.ts';
import { rememberDevDb } from './universe.ts';
import type { UniverseStore } from './universe.ts';

// Repo paths, anchored off this file so they hold regardless of cwd.
const REPO_ROOT = resolve(import.meta.dirname, '..');
const TOOLS_DIR = join(REPO_ROOT, 'tools', 'eod-import');
// Default target DB for imports when MARKETDATA_DB is unset. Lives at the repo
// root so a developer can point a future `MARKETDATA_DB` at the same file to
// persist imported data across restarts.
const DEFAULT_DB = join(REPO_ROOT, 'dev-market.db');

// DEV_TOOLS gates the whole feature. Explicit opt-in (set by the dev:server
// npm script) rather than NODE_ENV inference, so the same server entry run in
// production without the flag never exposes the import surface.
export function devToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEV_TOOLS === '1' || env.DEV_TOOLS === 'true';
}

// ---- options (GET /dev/import/options) ----

export interface ConfigOption {
  name: string; // file name, e.g. 'config.example.json' — the request echoes this back
  json: unknown; // raw parsed JSON, shown verbatim in the inline editor
}
export interface DataEntry {
  name: string;
  type: 'file' | 'dir';
  path: string; // absolute path, passed back as the browse input
}
export interface ImportOptions {
  configs: ConfigOption[];
  dataDir: string; // the browsable root (EOD_DATA_DIR or a sensible default)
  dataEntries: DataEntry[]; // immediate .csv files + subdirectories of dataDir
  targetDb: string; // where an import writes (MARKETDATA_DB or the dev default)
}

// The browsable root for the "Hybrid" file picker: EOD_DATA_DIR if set, else a
// repo `data/` dir if present, else the importer's bundled fixtures (which ship
// sample CSVs). Always returns a path even if it does not exist (entries empty).
function dataRoot(env: NodeJS.ProcessEnv): string {
  if (env.EOD_DATA_DIR) return resolve(env.EOD_DATA_DIR);
  const repoData = join(REPO_ROOT, 'data');
  if (existsSync(repoData)) return repoData;
  return join(TOOLS_DIR, 'fixtures');
}

function listConfigs(): ConfigOption[] {
  const out: ConfigOption[] = [];
  for (const name of readdirSync(TOOLS_DIR).sort()) {
    // Only `config*.json` — not the metadata.*.json side files or tsconfig.json.
    if (!/^config.*\.json$/.test(name)) continue;
    try {
      out.push({ name, json: JSON.parse(readFileSync(join(TOOLS_DIR, name), 'utf8')) });
    } catch {
      // A malformed config file shouldn't break the whole picker — skip it.
    }
  }
  return out;
}

function listDataEntries(root: string): DataEntry[] {
  if (!existsSync(root)) return [];
  const out: DataEntry[] = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) out.push({ name, type: 'dir', path });
    else if (extname(name).toLowerCase() === '.csv') out.push({ name, type: 'file', path });
  }
  return out;
}

export function listImportOptions(env: NodeJS.ProcessEnv = process.env): ImportOptions {
  const root = dataRoot(env);
  return {
    configs: listConfigs(),
    dataDir: root,
    dataEntries: listDataEntries(root),
    targetDb: env.MARKETDATA_DB || DEFAULT_DB,
  };
}

// ---- run (POST /dev/import) ----

export interface UploadFile { name: string; content: string }
export interface DevImportRequest {
  // The chosen config file name (must be one discovered in TOOLS_DIR). Metadata
  // resolution is anchored to this file's directory.
  configName: string;
  // Optional inline-edited config object. When present it overrides the file's
  // contents (the editor), but metadataFile is still resolved relative to the
  // named config's directory.
  configJson?: unknown;
  // Input is EITHER a server-side path (browse) OR uploaded file contents.
  inputPath?: string;
  uploads?: UploadFile[];
  // Optional override of the target DB; defaults to MARKETDATA_DB / dev default.
  targetDb?: string;
}

export interface DevImportResult {
  files: number;
  instruments: number;
  bars: number;
  skipped: number;
  errors: { file: string; line: number; reason: string; sample: string }[];
  targetDb: string;
  universe: number; // warm-universe size after the reload
}

// Validate the chosen config name and return its absolute path. Guards against
// path traversal: only files that listConfigs() surfaced are accepted.
function resolveConfigPath(configName: string): string {
  if (typeof configName !== 'string' || !configName) {
    throw new RequestError('configName is required');
  }
  const known = listConfigs().some((c) => c.name === configName);
  if (!known) throw new RequestError(`unknown config "${configName}"`);
  return join(TOOLS_DIR, configName);
}

// Materialise uploaded CSV contents into a fresh temp dir and return it as the
// single input path. The caller removes the dir afterwards.
function writeUploads(uploads: UploadFile[], dir: string): string {
  let wrote = 0;
  for (const f of uploads) {
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') continue;
    // basename() defeats any path component in an uploaded name.
    const safe = basename(f.name);
    if (extname(safe).toLowerCase() !== '.csv') continue;
    writeFileSync(join(dir, safe), f.content, 'utf8');
    wrote++;
  }
  if (wrote === 0) throw new RequestError('no .csv files in the upload');
  return dir;
}

export function runDevImport(
  req: DevImportRequest,
  store: UniverseStore,
  env: NodeJS.ProcessEnv = process.env,
): DevImportResult {
  const configPath = resolveConfigPath(req.configName);

  let config: ImportConfig;
  try {
    config = req.configJson !== undefined ? normalizeConfig(req.configJson) : loadConfig(configPath);
  } catch (e) {
    throw new RequestError(`invalid config: ${(e as Error).message}`);
  }

  // Metadata file (if any) is resolved relative to the named config's dir, so an
  // inline-edited config still finds its sibling metadata.*.json.
  let metadata;
  try {
    metadata = loadMetadata(config, configPath);
  } catch (e) {
    throw new RequestError(`could not load metadata file: ${(e as Error).message}`);
  }

  const targetDb = resolve(req.targetDb || env.MARKETDATA_DB || DEFAULT_DB);

  // Resolve the input: uploads take precedence; otherwise a server-side path.
  let tempDir: string | null = null;
  let inputPaths: string[];
  if (req.uploads && req.uploads.length > 0) {
    tempDir = mkdtempSync(join(tmpdir(), 'eod-upload-'));
    inputPaths = [writeUploads(req.uploads, tempDir)];
  } else if (req.inputPath) {
    const p = resolve(req.inputPath);
    if (!existsSync(p)) throw new RequestError(`input path does not exist: ${p}`);
    inputPaths = [p];
  } else {
    throw new RequestError('provide an inputPath or uploads');
  }

  try {
    const report = runImport(inputPaths, targetDb, config, metadata);
    // Swap the warm universe onto a fresh read-only connection to the DB we just
    // wrote (a new connection, so it sees the committed rows) and drop the cache.
    // Record the descriptor too, so the DB-selector shows this DB as active.
    store.reload(sqliteProvider(targetDb), { kind: 'sqlite', path: resolve(targetDb) });
    // Persist this DB as the active dev dataset so the switch survives a restart
    // (the in-memory reload above does not). Subsequent boots load it instead of
    // the synthetic generator until the pointer/DB is removed.
    rememberDevDb(targetDb);
    return {
      files: report.files,
      instruments: report.instruments,
      bars: report.bars,
      skipped: report.skipped,
      errors: report.errors.map((e) => ({ file: e.file, line: e.line, reason: e.reason, sample: e.sample })),
      targetDb,
      universe: store.get().length,
    };
  } catch (e) {
    // Importer/DB errors are operator-facing config/data problems → 400, not 500.
    throw new RequestError(`import failed: ${(e as Error).message}`);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
