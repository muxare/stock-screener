// config.ts — column mapping + parse config for the EOD CSV importer (STORY-031).
//
// DEV/TEST TOOLING ONLY (SAD#1.2 / SAD#8.7). A new CSV source (Stooq, Yahoo, a
// broker export) is onboarded by editing a JSON config — NOT by changing code.
// The config names which columns hold date/OHLCV/ticker/name/sector, how dates
// are formatted, and how tickers are normalized.

import { readFileSync } from 'node:fs';

// Which source column supplies each field. The OHLCV + date columns are
// required; `ticker`/`name`/`sector` are optional (ticker falls back to the
// filename; name falls back to the ticker; sector falls back to metadata or
// 'Unknown' — see run.ts).
export interface ColumnMapping {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  ticker?: string;
  name?: string;
  sector?: string;
}

// Supported input date formats. Whatever the source uses, dates are normalized
// to ISO `YYYY-MM-DD` for storage so the DB `date` column orders lexically
// (STORY-032 returns bars in chronological order by sorting on it).
export type DateFormat =
  | 'iso' //        2024-01-15  (also accepts 2024-01-15T00:00:00…)
  | 'yyyymmdd' //   20240115    (Stooq)
  | 'mm/dd/yyyy' // 01/15/2024  (US)
  | 'dd/mm/yyyy'; // 15/01/2024 (EU)

export interface TickerNormalization {
  // Upper/lower-case the ticker, or leave it untouched. Default 'upper'.
  case?: 'upper' | 'lower' | 'none';
  // Drop a trailing exchange suffix, e.g. Stooq's `.US` on `aapl.us`. Matched
  // case-insensitively against the end of the raw ticker.
  stripSuffix?: string;
}

export interface ImportConfig {
  columns: ColumnMapping;
  dateFormat: DateFormat;
  ticker: TickerNormalization;
  // Field delimiter; default ','.
  delimiter: string;
  // Whether the first row is a header naming the columns. Required true here:
  // the mapping references columns by name. (Kept explicit for clarity.)
  hasHeader: boolean;
  // Optional side metadata file: JSON of `{ "<TICKER>": { name?, sector? } }`,
  // consulted when a row carries no name/sector column. Path is relative to the
  // config file. Resolved/loaded by the caller (run.ts), not here.
  metadataFile?: string;
}

const REQUIRED_COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume'] as const;
const DATE_FORMATS: DateFormat[] = ['iso', 'yyyymmdd', 'mm/dd/yyyy', 'dd/mm/yyyy'];

const DEFAULTS = {
  dateFormat: 'iso' as DateFormat,
  delimiter: ',',
  hasHeader: true,
  ticker: { case: 'upper' as const },
};

// Per-ticker name/sector overrides from the optional side metadata file.
export type Metadata = Record<string, { name?: string; sector?: string }>;

// Parse + validate a config object (already JSON-parsed) into a fully-defaulted
// ImportConfig. Throws a clear Error on any invalid/missing field so a bad
// config fails fast at startup rather than mangling data.
export function normalizeConfig(raw: unknown): ImportConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('config must be a JSON object');
  }
  const r = raw as Record<string, unknown>;

  const cols = r.columns;
  if (typeof cols !== 'object' || cols === null) {
    throw new Error('config.columns is required and must be an object');
  }
  const c = cols as Record<string, unknown>;
  for (const field of REQUIRED_COLUMNS) {
    if (typeof c[field] !== 'string' || !(c[field] as string).trim()) {
      throw new Error(`config.columns.${field} is required (the source column name)`);
    }
  }

  const dateFormat = (r.dateFormat as DateFormat) ?? DEFAULTS.dateFormat;
  if (!DATE_FORMATS.includes(dateFormat)) {
    throw new Error(`config.dateFormat must be one of: ${DATE_FORMATS.join(', ')}`);
  }

  const tickerRaw = (r.ticker as TickerNormalization) ?? {};
  const tickerCase = tickerRaw.case ?? DEFAULTS.ticker.case;
  if (!['upper', 'lower', 'none'].includes(tickerCase)) {
    throw new Error("config.ticker.case must be 'upper', 'lower', or 'none'");
  }

  return {
    columns: {
      date: c.date as string,
      open: c.open as string,
      high: c.high as string,
      low: c.low as string,
      close: c.close as string,
      volume: c.volume as string,
      ticker: typeof c.ticker === 'string' ? c.ticker : undefined,
      name: typeof c.name === 'string' ? c.name : undefined,
      sector: typeof c.sector === 'string' ? c.sector : undefined,
    },
    dateFormat,
    ticker: { case: tickerCase, stripSuffix: tickerRaw.stripSuffix },
    delimiter: typeof r.delimiter === 'string' && r.delimiter ? r.delimiter : DEFAULTS.delimiter,
    hasHeader: r.hasHeader === undefined ? DEFAULTS.hasHeader : Boolean(r.hasHeader),
    metadataFile: typeof r.metadataFile === 'string' ? r.metadataFile : undefined,
  };
}

// Load + validate a config from a JSON file path.
export function loadConfig(path: string): ImportConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`could not read config file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`config file is not valid JSON (${path}): ${(e as Error).message}`, { cause: e });
  }
  return normalizeConfig(parsed);
}
