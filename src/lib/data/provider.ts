// provider.ts — MarketDataProvider port (SAD#5.10).
//
// The single boundary through which adjusted OHLCV bars + universe metadata
// enter the system. Adapters implement this port: a synthetic dev/test adapter
// (ADR-007, `./synthetic`) and a future licensed vendor adapter (ADR-008).
// The engine never calls a provider directly — bars are passed into engine
// functions (SAD#8.4 / ADR-004).

import type { InstrumentBars } from '../market';

// The engine's input contract (`InstrumentBars`) is also the provider's output
// contract: universe metadata + adjusted OHLCV bars. Re-exported here so data
// adapters can depend on the port alone.
export type { InstrumentBars } from '../market';

export interface MarketDataProvider {
  /**
   * The production universe as adjusted OHLCV bars + metadata. Bars are
   * corporate-action adjusted at ingestion, before the engine sees them
   * (SAD#2.2 / ADR-005).
   */
  getUniverse(): InstrumentBars[];

  /**
   * A single instrument's adjusted OHLCV bars + metadata, by ticker, or `null`
   * if the ticker is not in the universe. Serves the client's displayed-name
   * compute (detail/compare) without building the whole universe — the client
   * computes only the names it shows (SAD#2.5 / SAD#4.1). The returned bars are
   * identical to the same name in `getUniverse()`.
   */
  getInstrument(ticker: string): InstrumentBars | null;

  /**
   * Release any resources the adapter holds (e.g. an open database handle), after
   * which the provider must not be used again. **Optional**: an adapter that holds
   * no resources (the synthetic generator) omits it, and callers treat its absence
   * as a no-op — `provider.close?.()`. Releasing the handle is what lets the EOD
   * importer overwrite the backing DB file while the service is running, and lets
   * tests delete a temp DB without a leaked connection (SAD#4.3 / SAD#5.10).
   */
  close?(): void;
}
