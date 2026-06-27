// devDataset.ts — dev-only DB-selector endpoint backing (STORY-035 in the UI).
//
// DEV/TEST TOOLING ONLY (SAD#1.2 / SAD#8.7), the sibling of devImport.ts. Where
// devImport *writes* a SQLite DB (CSV → DB) and switches onto it, this module
// lets a developer *pick* an already-built market-data DB and switch the running
// service onto it at runtime — without an import and without a restart. It is
// gated behind the same DEV_TOOLS flag (the routes are only registered when the
// flag is on, server/index.ts), so it cannot exist in a production deployment.
//
// It does NOT touch the engine or handlers: switching datasets is a provider
// swap behind the SAD#5.10 port (universe.ts `reload`), exactly like an import.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RequestError } from './handlers.ts';
import { rememberDevDb, forgetDevDb, providerForSource } from './universe.ts';
import type { UniverseStore, DatasetSource } from './universe.ts';

// Repo root, anchored off this file so it holds regardless of cwd — the default
// place the importer writes DBs (devImport.ts DEFAULT_DB lives here too).
const REPO_ROOT = resolve(import.meta.dirname, '..');

// ---- options (GET /dev/databases) ----

export interface DatabaseEntry {
  name: string; // file name, e.g. 'dev-market.db'
  path: string; // absolute path — passed back verbatim to activate
  sizeBytes: number;
  instruments: number | null; // name count, or null if not a readable STORY-031 DB
  valid: boolean; // a readable STORY-031 market-data DB (vs a stray .db file)
  active: boolean; // the dataset currently being served
}
export interface DatabaseList {
  activeKind: DatasetSource['kind']; // 'synthetic' | 'sqlite'
  activePath: string | null; // resolved path when sqlite, else null
  scanDir: string; // the directory scanned for .db files
  databases: DatabaseEntry[];
}

// The directory scanned for candidate DBs: MARKETDATA_DIR if set, else the repo
// root (where imports land by default). Always returns a path even if empty.
function databasesRoot(env: NodeJS.ProcessEnv): string {
  return env.MARKETDATA_DIR ? resolve(env.MARKETDATA_DIR) : REPO_ROOT;
}

// Open a candidate DB read-only and count its instruments. Returns null when the
// file is not a readable STORY-031 market-data DB (wrong schema, locked, etc.) —
// such files are still listed but flagged invalid, never selectable.
function inspect(path: string): number | null {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('instrument', 'bar')")
      .all() as unknown as { name: string }[];
    if (tables.length < 2) return null;
    const row = db.prepare('SELECT count(*) AS n FROM instrument').get() as unknown as { n: number };
    return row.n;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// Discover the candidate DB paths: every *.db file directly under the scan dir,
// plus the currently-active DB (which may live elsewhere, e.g. MARKETDATA_DB
// outside the repo). Resolved + de-duplicated so membership checks are exact.
function discoverPaths(store: UniverseStore, env: NodeJS.ProcessEnv): string[] {
  const root = databasesRoot(env);
  const found = new Set<string>();
  if (existsSync(root)) {
    for (const name of readdirSync(root).sort()) {
      if (extname(name).toLowerCase() !== '.db') continue;
      const p = join(root, name);
      try { if (statSync(p).isFile()) found.add(resolve(p)); } catch { /* skip */ }
    }
  }
  const src = store.source();
  if (src.kind === 'sqlite') found.add(resolve(src.path));
  return [...found];
}

export function listDatabases(store: UniverseStore, env: NodeJS.ProcessEnv = process.env): DatabaseList {
  const src = store.source();
  const activePath = src.kind === 'sqlite' ? resolve(src.path) : null;
  const databases: DatabaseEntry[] = discoverPaths(store, env).map((path) => {
    let sizeBytes = 0;
    try { sizeBytes = statSync(path).size; } catch { /* unreadable → 0 */ }
    const instruments = inspect(path);
    return {
      name: basename(path),
      path,
      sizeBytes,
      instruments,
      valid: instruments !== null,
      active: path === activePath,
    };
  });
  // Stable, human-friendly order: by file name.
  databases.sort((a, b) => a.name.localeCompare(b.name));
  return { activeKind: src.kind, activePath, scanDir: databasesRoot(env), databases };
}

// ---- activate (POST /dev/databases/activate) ----

export interface ActivateRequest {
  // Switch to this SQLite DB (absolute path; must be one listDatabases surfaced).
  path?: string;
  // OR switch back to the synthetic generator. Mutually exclusive with `path`.
  synthetic?: boolean;
}
export interface ActivateResult {
  activeKind: DatasetSource['kind'];
  activePath: string | null;
  universe: number; // warm-universe size after the swap
}

// `pointerPath` is overridable for tests so they never touch the real repo
// `.dev-active-db` (same convention as universe.ts rememberDevDb/forgetDevDb).
export function activateDatabase(
  req: ActivateRequest,
  store: UniverseStore,
  env: NodeJS.ProcessEnv = process.env,
  pointerPath?: string,
): ActivateResult {
  // Back to the generated dataset: swap onto synthetic and drop the dev pointer
  // so the choice survives a restart (the in-memory reload alone would not).
  if (req.synthetic) {
    const source: DatasetSource = { kind: 'synthetic' };
    store.reload(providerForSource(source), source);
    forgetDevDb(pointerPath);
    return { activeKind: 'synthetic', activePath: null, universe: store.get().length };
  }

  if (typeof req.path !== 'string' || !req.path) {
    throw new RequestError('provide a database path, or { synthetic: true }');
  }
  const target = resolve(req.path);

  // Guard against arbitrary file access: only paths discoverDatabases() surfaced
  // are selectable (mirrors devImport's config allow-listing). A path outside the
  // scan dir that is not already active is rejected rather than opened.
  const allowed = new Set(discoverPaths(store, env));
  if (!allowed.has(target)) {
    throw new RequestError(`unknown database "${req.path}"`);
  }

  // sqliteProvider validates the file + STORY-031 schema and throws on failure;
  // surface that as a 400 (operator chose a bad DB), not a 500.
  const source: DatasetSource = { kind: 'sqlite', path: target };
  let provider;
  try {
    provider = providerForSource(source);
  } catch (e) {
    throw new RequestError(`could not open database: ${(e as Error).message}`);
  }
  store.reload(provider, source);
  // Persist as the active dev dataset so the switch survives a restart.
  rememberDevDb(target, pointerPath);
  return { activeKind: 'sqlite', activePath: target, universe: store.get().length };
}
