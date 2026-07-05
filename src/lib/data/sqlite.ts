// sqlite.ts — SQLite-backed MarketDataProvider adapter (STORY-032).
//
// DEV/TEST ONLY (SAD#8.7 / ADR-007), the sibling of `synthetic.ts`. It reads a
// database produced by the EOD CSV importer (STORY-031, tools/eod-import) and
// serves it through the SAD#5.10 `MarketDataProvider` port, so the app and
// screening service run against imported dev/test data with no engine or handler
// changes. It is NOT the licensed vendor adapter (STORY-015 / ADR-008).
//
// Uses Node's built-in synchronous `node:sqlite` — no third-party dependency,
// matching the importer. The port is synchronous (`getUniverse(): InstrumentBars[]`),
// so the adapter must read synchronously. Because this imports `node:sqlite`, it
// is server-only and must never enter the client bundle (wired in server/universe.ts).
//
// The connection is opened read-only (SAD#4.3: the market-data store is read-only
// to the rest of the system) and the DB is validated at construction, so a
// missing file or a non-STORY-031 schema fails fast with a clear message rather
// than crashing later at the first query. Statements are prepared ONCE and reused
// — getInstrument is the per-request single-name hot path (SAD#2.5).

import { DatabaseSync } from 'node:sqlite';
import type { Bar } from '../market';
import type { InstrumentBars, MarketDataProvider } from './provider';

// Row shapes for the two tables of the STORY-031 schema (SAD#6.1).
interface InstrumentRow { ticker: string; name: string; sector: string; }
// The engine `Bar` shape is {o,h,l,c,v}; the DB `date` column orders the bars
// chronologically and is NOT part of `Bar` (SAD#6.1). It is still selected so it
// can be returned alongside the bars as `InstrumentBars.dates` (a parallel array
// the detail chart labels with), never folded into a `Bar`.
interface OhlcvRow { date: string; o: number; h: number; l: number; c: number; v: number; }
interface TickerOhlcvRow extends OhlcvRow { ticker: string; } // + ticker, for grouping

function toBar(r: OhlcvRow): Bar {
  return { o: r.o, h: r.h, l: r.l, c: r.c, v: r.v };
}

/**
 * A `MarketDataProvider` backed by a SQLite database produced by STORY-031.
 * The connection is opened **read-only** (SAD#4.3) once and reused for the
 * process lifetime. The adapter performs NO corporate-action adjustment — it
 * trusts the importer's pre-adjusted bars (SAD#2.2 / ADR-005) and returns them
 * verbatim. It contains no vendor SDK.
 */
export function sqliteProvider(dbPath: string): MarketDataProvider {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    throw new Error(
      `sqliteProvider: could not open market-data DB at "${dbPath}" ` +
        `(set via MARKETDATA_DB). Build it with the EOD importer (STORY-031) first.`,
      { cause: e },
    );
  }

  // From here the DB handle is open: any construction failure (bad schema, a
  // prepare error) must release it before throwing, or a caller that catches the
  // error still leaks the read handle — the very defect this lifecycle closes.
  let selInstruments: ReturnType<DatabaseSync['prepare']>;
  let selAllBars: ReturnType<DatabaseSync['prepare']>;
  let selInstrument: ReturnType<DatabaseSync['prepare']>;
  let selInstrumentBars: ReturnType<DatabaseSync['prepare']>;
  try {
    // Fail fast on a valid SQLite file that is not a STORY-031 market-data DB,
    // instead of crashing later with an opaque "no such table" at the first query.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('instrument', 'bar')")
      .all() as unknown as { name: string }[];
    if (tables.length < 2) {
      throw new Error(
        `sqliteProvider: "${dbPath}" is not a STORY-031 market-data DB ` +
          `(missing the instrument/bar tables).`,
      );
    }

    // Prepared once, reused per call (SAD#2.5 hot path) — no per-request recompile.
    selInstruments = db.prepare('SELECT ticker, name, sector FROM instrument ORDER BY ticker');
    selAllBars = db.prepare('SELECT ticker, date, o, h, l, c, v FROM bar ORDER BY ticker, date');
    selInstrument = db.prepare('SELECT ticker, name, sector FROM instrument WHERE ticker = ?');
    selInstrumentBars = db.prepare('SELECT date, o, h, l, c, v FROM bar WHERE ticker = ? ORDER BY date');
  } catch (e) {
    db.close(); // release the handle before surfacing the construction error
    throw e;
  }

  return {
    getUniverse(): InstrumentBars[] {
      const instruments = selInstruments.all() as unknown as InstrumentRow[];

      // One pass over all bars, chronological within each ticker, grouped by
      // ticker — avoids an N+1 query while keeping each name's bars date-ordered.
      // Dates accumulate into a parallel array, index-aligned with `bars`.
      const barRows = selAllBars.all() as unknown as TickerOhlcvRow[];
      const barsByTicker = new Map<string, Bar[]>();
      const datesByTicker = new Map<string, string[]>();
      for (const r of barRows) {
        let arr = barsByTicker.get(r.ticker);
        if (!arr) { arr = []; barsByTicker.set(r.ticker, arr); }
        arr.push(toBar(r));
        let darr = datesByTicker.get(r.ticker);
        if (!darr) { darr = []; datesByTicker.set(r.ticker, darr); }
        darr.push(r.date);
      }

      return instruments.map((i) => ({
        ticker: i.ticker,
        name: i.name,
        sector: i.sector,
        bars: barsByTicker.get(i.ticker) ?? [],
        dates: datesByTicker.get(i.ticker) ?? [],
      }));
    },

    getInstrument(ticker: string): InstrumentBars | null {
      const instrument = selInstrument.get(ticker) as unknown as InstrumentRow | undefined;
      if (!instrument) return null;

      // Same ORDER BY date as getUniverse, so the bars are identical to this
      // name in getUniverse() (AC) — chronological, {o,h,l,c,v} only, with the
      // calendar dates returned beside them in a parallel `dates` array.
      const barRows = selInstrumentBars.all(ticker) as unknown as OhlcvRow[];

      return {
        ticker: instrument.ticker,
        name: instrument.name,
        sector: instrument.sector,
        bars: barRows.map(toBar),
        dates: barRows.map((r) => r.date),
      };
    },

    // Release the read-only connection (SAD#5.10 lifecycle). After this the read
    // handle is dropped, so the importer can overwrite the DB file (STORY-031) and
    // tests can delete a temp DB without leaking it; any further call throws.
    close(): void {
      db.close();
    },
  };
}
