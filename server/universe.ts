// universe.ts — warm, memoized production universe (SAD#4.3 / SAD#2.3).
//
// The universe is built ONCE and reused across requests so the per-Stock
// indicator caches (`_indCache`, `_pcfEma`, …) computed during evaluation stay
// warm — this is the "warm-cache" path the SAD#2.3 p95 budget is stated for.
// Bars enter only through the MarketDataProvider port (SAD#5.10): the service
// depends on the port, never a concrete vendor SDK.

import { buildUniverse } from '../src/lib/market.ts';
import type { InstrumentBars, Stock } from '../src/lib/market.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { sqliteProvider } from '../src/lib/data/sqlite.ts';
import type { MarketDataProvider } from '../src/lib/data/provider.ts';

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
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): MarketDataProvider {
  const dbPath = env.MARKETDATA_DB;
  return dbPath ? sqliteProvider(dbPath) : syntheticProvider(7);
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
}

export function createUniverseStore(provider: MarketDataProvider = defaultProvider): UniverseStore {
  let cached: Stock[] | null = null;
  return {
    get(): Stock[] {
      if (!cached) cached = buildUniverse(provider.getUniverse());
      return cached;
    },
    getInstrument(ticker: string): InstrumentBars | null {
      return provider.getInstrument(ticker);
    },
  };
}

// The singleton the running service screens against.
export const productionUniverse: UniverseStore = createUniverseStore();
