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
}
