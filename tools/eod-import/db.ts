// db.ts — SQLite schema + idempotent writer for the EOD importer (STORY-031).
//
// Schema is the SAD#6.1 model: an `instrument` table (ticker, name, sector) and
// a daily-OHLCV `bar` table keyed on (ticker, date). The store is READ-ONLY to
// the rest of the system (SAD#4.3); this writer is the only thing that mutates
// it, and the SQLite-backed read adapter (STORY-032) consumes it through the
// MarketDataProvider port.
//
// Uses Node's built-in synchronous `node:sqlite` — no third-party dependency,
// and synchronous to match the synchronous read adapter STORY-032 will build.

import { DatabaseSync } from 'node:sqlite';
import type { ParsedBar } from './parse.ts';

// Resolved per-instrument metadata, after applying CSV column → metadata file →
// defaults precedence (see run.ts).
export interface InstrumentRow {
  ticker: string;
  name: string;
  sector: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS instrument (
  ticker TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  sector TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bar (
  ticker TEXT NOT NULL,
  date   TEXT NOT NULL,
  o REAL NOT NULL,
  h REAL NOT NULL,
  l REAL NOT NULL,
  c REAL NOT NULL,
  v REAL NOT NULL,
  PRIMARY KEY (ticker, date)
);
`;

export interface WriteResult {
  instruments: number;
  bars: number;
}

export class EodDatabase {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // Pragmas tuned for a one-shot bulk dev import (durability is not a concern
    // for a regenerable dev/test DB — SAD#2.8 durability applies to artifacts).
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
  }

  // Upsert instruments + bars in a single transaction. Re-running with the same
  // input is idempotent: ON CONFLICT(ticker, date) overwrites the bar in place,
  // and ON CONFLICT(ticker) refreshes instrument metadata — no duplicates.
  write(instruments: InstrumentRow[], bars: ParsedBar[]): WriteResult {
    const insInstrument = this.db.prepare(
      `INSERT INTO instrument (ticker, name, sector) VALUES (?, ?, ?)
       ON CONFLICT(ticker) DO UPDATE SET name = excluded.name, sector = excluded.sector`,
    );
    const insBar = this.db.prepare(
      `INSERT INTO bar (ticker, date, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ticker, date) DO UPDATE SET
         o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v`,
    );

    this.db.exec('BEGIN');
    try {
      for (const i of instruments) insInstrument.run(i.ticker, i.name, i.sector);
      for (const b of bars) insBar.run(b.ticker, b.date, b.o, b.h, b.l, b.c, b.v);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { instruments: instruments.length, bars: bars.length };
  }

  close(): void {
    this.db.close();
  }
}
