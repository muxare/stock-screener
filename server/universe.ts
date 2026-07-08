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

// MVP boot default (ADR-008 interim decision, SAD#8.8): the DB the Yahoo importer
// builds (`yahoo:backfill`, tools/yahoo-fetch → repo-root `yahoo-market.db`). When
// present, the dev service boots on it so manual testing runs on real,
// split/dividend-adjusted bars (bar.c = adjClose) instead of the synthetic
// generator. This mirrors tools/yahoo-fetch/backfill.ts DEFAULT_YAHOO_DB; it is
// redefined here (not imported) to keep server/ from depending on tools/.
const DEFAULT_YAHOO_DB = join(resolve(import.meta.dirname, '..'), 'yahoo-market.db');

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

// The Yahoo MVP default DB, if it exists AND we are in a dev/test context. Gated
// on DEV_TOOLS exactly like the dev pointer above: the Yahoo build is a local,
// personal-use MVP dataset (ADR-008 interim / SAD#8.8), never a production path,
// and the production guard in providerFromEnv() refuses it there anyway. Returns
// null on a fresh checkout with no backfill, so boot falls back to synthetic
// rather than fail-fasting on a missing file (unlike an explicit MARKETDATA_DB).
function defaultYahooDb(env: NodeJS.ProcessEnv, yahooDbPath: string = DEFAULT_YAHOO_DB): string | null {
  if (env.DEV_TOOLS !== '1' && env.DEV_TOOLS !== 'true') return null;
  return existsSync(yahooDbPath) ? yahooDbPath : null;
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
  yahooDbPath: string = DEFAULT_YAHOO_DB,
): DatasetSource {
  const dbPath = env.MARKETDATA_DB;
  if (dbPath) return { kind: 'sqlite', path: resolve(dbPath) };
  const devDb = persistedDevDb(env, pointerPath);
  if (devDb) return { kind: 'sqlite', path: resolve(devDb) };
  // MVP boot default: an explicitly-selected dev DB (pointer, above) wins, but
  // absent one, boot on the Yahoo build when it exists (ADR-008 interim / SAD#8.8).
  const yahooDb = defaultYahooDb(env, yahooDbPath);
  if (yahooDb) return { kind: 'sqlite', path: yahooDb };
  return { kind: 'synthetic' };
}

// Build the live provider for a dataset descriptor. Opening a SQLite source
// validates the file/schema and throws on failure (fail-fast, see below).
export function providerForSource(source: DatasetSource): MarketDataProvider {
  return source.kind === 'sqlite' ? sqliteProvider(source.path) : syntheticProvider(7);
}

// Until ADR-008 (SAD#8.8) selects a licensed vendor and legal sign-off lands
// (STORY-015 ships that adapter), the adapters behind the port are the dev/test
// ones (SAD#8.7): the SQLite reader (STORY-032) when a DB is selected — via
// MARKETDATA_DB, the dev pointer, or the Yahoo MVP build (yahoo-market.db, the
// ADR-008 interim default) — else the synthetic generator. Because the service
// consumes the PORT, selecting an adapter is a config switch here — no handler
// or engine edits.
//
// When MARKETDATA_DB is SET, the SQLite adapter is chosen and an unreadable or
// non-STORY-031 DB throws here (fail-fast). It is deliberately NOT silently
// downgraded to synthetic: the operator asked for imported data, so masking a
// misconfiguration by serving demo data would be worse than a clear startup error.
//
// PRODUCTION GUARD (SAD#8.7): both adapters above are dev/test only — there is no
// genuine production data path yet (the licensed-vendor adapter is deferred to
// ADR-008 / SAD#8.8). So in a production environment selecting EITHER fails fast
// with a clear error here, rather than letting demo/imported data silently back
// production screening traffic.
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  pointerPath: string = DEV_ACTIVE_DB_POINTER,
  yahooDbPath: string = DEFAULT_YAHOO_DB,
): MarketDataProvider {
  const source = sourceFromEnv(env, pointerPath, yahooDbPath);
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to serve the '${source.kind}' dev/test market-data adapter in a ` +
        `production environment (NODE_ENV=production): the synthetic generator (SAD#8.7) ` +
        `and the SQLite reader (STORY-032) are dev/test only and must never back ` +
        `production screening traffic. The production adapter is deferred to ADR-008 (SAD#8.8).`,
    );
  }
  return providerForSource(source);
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
  // Dispose the active provider (release its handle) on shutdown (SAD#5.10
  // lifecycle). A no-op for adapters that hold no resources (synthetic). After
  // this the store must not be used again.
  close(): void;
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
      // Swapping providers: release the outgoing one's handle so re-importing to
      // the same DB path isn't blocked by our own open read connection (STORY-031
      // / SAD#4.3). Guard against closing a provider we're keeping.
      if (next && next !== active) {
        active.close?.();
        active = next;
      }
      if (source) activeSource = source;
      cached = null;
    },
    source(): DatasetSource {
      return activeSource;
    },
    close(): void {
      active.close?.();
    },
  };
}

// The singleton the running service screens against.
export const productionUniverse: UniverseStore = createUniverseStore();
