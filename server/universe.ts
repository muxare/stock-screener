// universe.ts — warm, memoized production universe (SAD#4.3 / SAD#2.3).
//
// The universe is built ONCE and reused across requests so the per-Stock
// indicator caches (`_indCache`, `_pcfEma`, …) computed during evaluation stay
// warm — this is the "warm-cache" path the SAD#2.3 p95 budget is stated for.
// Bars enter only through the MarketDataProvider port (SAD#5.10): the service
// depends on the port, never a concrete vendor SDK.

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildUniverse } from '../src/lib/market.ts';
import type { InstrumentBars, Stock } from '../src/lib/market.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { sqliteProvider } from '../src/lib/data/sqlite.ts';
import type { MarketDataProvider } from '../src/lib/data/provider.ts';

// Dev-only "active dataset" pointer (STORY-031). After an EOD import the running
// service hot-swaps onto the imported DB (reload(), below), but that swap is
// in-memory: a process restart — including `node --watch` firing on any server
// edit — would otherwise revert to the synthetic generator. So the import tool
// records the imported DB path here, and providerFromEnv() boots from it. The
// file is gitignored and only ever written by the DEV_TOOLS-gated import surface,
// so production never creates or reads it (and MARKETDATA_DB still wins anyway).
// Delete the pointer (or the DB) to fall back to the synthetic dataset.
const DEV_ACTIVE_DB_POINTER = join(resolve(import.meta.dirname, '..'), '.dev-active-db');

// Persist the imported DB as the dev "active dataset" so it survives restarts.
// Best-effort: a write failure just means the next boot falls back to synthetic.
// `pointerPath` is overridable for tests so they never touch the real repo file.
export function rememberDevDb(dbPath: string, pointerPath: string = DEV_ACTIVE_DB_POINTER): void {
  try { writeFileSync(pointerPath, resolve(dbPath), 'utf8'); } catch { /* best-effort */ }
}

// Drop the dev "active dataset" pointer so the next boot falls back to the
// synthetic generator. Called when the operator switches the dataset back to
// synthetic from the UI (server/devDataset.ts). Best-effort, like rememberDevDb:
// a missing pointer is the desired end state, so an unlink failure is ignored.
export function forgetDevDb(pointerPath: string = DEV_ACTIVE_DB_POINTER): void {
  try { rmSync(pointerPath, { force: true }); } catch { /* best-effort */ }
}

// The persisted dev dataset, if one is recorded AND still on disk. Dev-only: the
// pointer is honoured only when DEV_TOOLS is on (the same gate as the import
// surface — inlined to avoid a universe<->devImport import cycle). A stale
// pointer whose DB was deleted silently yields null → synthetic, so a cleaned-up
// temp DB never crashes boot.
function persistedDevDb(env: NodeJS.ProcessEnv, pointerPath: string = DEV_ACTIVE_DB_POINTER): string | null {
  if (env.DEV_TOOLS !== '1' && env.DEV_TOOLS !== 'true') return null;
  try {
    const p = readFileSync(pointerPath, 'utf8').trim();
    return p && existsSync(p) ? p : null;
  } catch { return null; }
}

// Which adapter is feeding the system, as a serialisable descriptor. The store
// tracks this so the dev DB-selector UI (STORY-035) can show what is active and
// switch between datasets at runtime, not just at boot. `synthetic` carries no
// path; `sqlite` carries the (resolved) DB file behind the SQLite reader.
export type DatasetSource =
  | { kind: 'synthetic' }
  | { kind: 'sqlite'; path: string };

// The dataset the service should boot against, as a descriptor (no I/O — it does
// not open the DB, so it never throws). Mirrors the precedence below:
// MARKETDATA_DB wins; else the persisted dev pointer (DEV_TOOLS only); else
// synthetic. `providerFromEnv` turns this into a live provider.
export function sourceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  pointerPath: string = DEV_ACTIVE_DB_POINTER,
): DatasetSource {
  const dbPath = env.MARKETDATA_DB;
  if (dbPath) return { kind: 'sqlite', path: resolve(dbPath) };
  const devDb = persistedDevDb(env, pointerPath);
  return devDb ? { kind: 'sqlite', path: resolve(devDb) } : { kind: 'synthetic' };
}

// Build the live provider for a dataset descriptor. Opening a SQLite source
// validates the file/schema and throws on failure (fail-fast, see below).
export function providerForSource(source: DatasetSource): MarketDataProvider {
  return source.kind === 'sqlite' ? sqliteProvider(source.path) : syntheticProvider(7);
}

// Until ADR-008 (SAD#8.8) selects a licensed vendor and legal sign-off lands
// (STORY-015 ships that adapter), the adapters behind the port are the dev/test
// ones (SAD#8.7): the synthetic generator by default, or — when MARKETDATA_DB
// points at a database built by the EOD importer (STORY-031) — the SQLite reader
// (STORY-032). Because the service consumes the PORT, selecting an adapter is a
// config switch here — no handler or engine edits.
//
// When MARKETDATA_DB is SET, the SQLite adapter is chosen and an unreadable or
// non-STORY-031 DB throws here (fail-fast). It is deliberately NOT silently
// downgraded to synthetic: the operator asked for imported data, so masking a
// misconfiguration by serving demo data would be worse than a clear startup error.
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  pointerPath: string = DEV_ACTIVE_DB_POINTER,
): MarketDataProvider {
  return providerForSource(sourceFromEnv(env, pointerPath));
}

const defaultProvider: MarketDataProvider = providerFromEnv();

export interface UniverseStore {
  // The warm, memoized universe. Repeated calls return the SAME Stock[] so
  // indicator caches accumulated during evaluation are honoured.
  get(): Stock[];
  // One instrument's adjusted bars + metadata by ticker (SAD#4.3 / SAD#5.10),
  // or null if the ticker is unknown. Delegates straight to the provider port —
  // serving a single name never triggers a full-universe build (SAD#2.5). The
  // client builds the Stock locally for the names it displays (SAD#4.1).
  getInstrument(ticker: string): InstrumentBars | null;
  // Drop the warm cache so the next get()/getInstrument() rebuilds from the
  // provider, optionally swapping in a new provider (and recording the dataset
  // descriptor behind it, so source() stays truthful). DEV/TEST ONLY (SAD#8.7):
  // the EOD-import dev tool (STORY-031) and the DB-selector (STORY-035) call this
  // after writing/choosing a SQLite DB so the new data is served without a
  // process restart. The production data path never mutates the provider at runtime.
  reload(provider?: MarketDataProvider, source?: DatasetSource): void;
  // The descriptor of the dataset currently being served. Drives the dev
  // DB-selector's "active" marker (STORY-035). Defaults to the boot source.
  source(): DatasetSource;
}

export function createUniverseStore(
  provider: MarketDataProvider = defaultProvider,
  initialSource: DatasetSource = sourceFromEnv(),
): UniverseStore {
  let cached: Stock[] | null = null;
  let active = provider;
  let activeSource = initialSource;
  return {
    get(): Stock[] {
      if (!cached) cached = buildUniverse(active.getUniverse());
      return cached;
    },
    getInstrument(ticker: string): InstrumentBars | null {
      return active.getInstrument(ticker);
    },
    reload(next?: MarketDataProvider, source?: DatasetSource): void {
      if (next) active = next;
      if (source) activeSource = source;
      cached = null;
    },
    source(): DatasetSource {
      return activeSource;
    },
  };
}

// The singleton the running service screens against.
export const productionUniverse: UniverseStore = createUniverseStore();
