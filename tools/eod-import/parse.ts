// parse.ts — CSV parsing, date/ticker normalization, and row → bar mapping
// for the EOD importer (STORY-031).
//
// Pure functions only: no SQLite, no filesystem (the caller supplies file text).
// Bars are trusted as PRE-ADJUSTED here — this tool performs NO corporate-action
// math (SAD#2.2 / ADR-005 stay with the vendor adapter, STORY-015). Malformed
// rows are collected as errors and skipped; one bad row never aborts a file.

import type { DateFormat, ImportConfig, TickerNormalization } from './config.ts';

// A successfully parsed bar row. `date` is normalized to ISO `YYYY-MM-DD`.
// `name`/`sector` are whatever the row carried (may be undefined); final
// resolution (metadata file, defaults) happens in run.ts.
export interface ParsedBar {
  ticker: string;
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  name?: string;
  sector?: string;
}

export interface RowError {
  file: string;
  line: number; // 1-based line number in the source file
  reason: string;
  sample: string; // the raw line, truncated, for the report
}

export interface ParseResult {
  bars: ParsedBar[];
  errors: RowError[];
}

// ---------- CSV ----------

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""),
// embedded delimiters/newlines inside quotes, and CRLF or LF line endings.
// Returns rows of string cells. A trailing newline yields no empty final row.
export function parseCSV(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false; // distinguishes a real empty trailing row from none

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
      cellStarted = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (cellStarted || cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = '';
      cellStarted = false;
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (cellStarted || cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------- dates ----------

// Normalize a raw date string to ISO `YYYY-MM-DD`, or return null if it does not
// match the configured format / is not a real calendar date.
export function normalizeDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim();
  let y: number, mo: number, d: number;
  switch (format) {
    case 'iso': {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
      if (!m) return null;
      [y, mo, d] = [+m[1], +m[2], +m[3]];
      break;
    }
    case 'yyyymmdd': {
      const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
      if (!m) return null;
      [y, mo, d] = [+m[1], +m[2], +m[3]];
      break;
    }
    case 'mm/dd/yyyy': {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (!m) return null;
      [mo, d, y] = [+m[1], +m[2], +m[3]];
      break;
    }
    case 'dd/mm/yyyy': {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (!m) return null;
      [d, mo, y] = [+m[1], +m[2], +m[3]];
      break;
    }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject impossible days (e.g. 02/30) via a round-trip through UTC.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// ---------- tickers ----------

export function normalizeTicker(raw: string, opts: TickerNormalization): string {
  let t = raw.trim();
  if (opts.stripSuffix) {
    const suffix = opts.stripSuffix.toLowerCase();
    if (t.toLowerCase().endsWith(suffix)) t = t.slice(0, t.length - suffix.length);
  }
  if (opts.case === 'upper') t = t.toUpperCase();
  else if (opts.case === 'lower') t = t.toLowerCase();
  return t.trim();
}

// ---------- row → bar ----------

function parseNum(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Map one file's CSV text into bars + errors. `fallbackTicker` (typically the
// filename stem) is used when the config has no ticker column, or the row's
// ticker cell is blank — supporting the one-file-per-ticker layout.
export function parseFile(
  text: string,
  fileName: string,
  config: ImportConfig,
  fallbackTicker: string,
): ParseResult {
  const rows = parseCSV(text, config.delimiter);
  const bars: ParsedBar[] = [];
  const errors: RowError[] = [];

  if (rows.length === 0) return { bars, errors };

  // Build a column-name → index map from the header row.
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string): number => header.indexOf(name);
  const col = config.columns;

  // Verify the required columns exist before processing any data row.
  const required: [keyof typeof col, string][] = [
    ['date', col.date], ['open', col.open], ['high', col.high],
    ['low', col.low], ['close', col.close], ['volume', col.volume],
  ];
  for (const [, name] of required) {
    if (idx(name) < 0) {
      errors.push({
        file: fileName, line: 1,
        reason: `header is missing mapped column "${name}"`,
        sample: rows[0].join(config.delimiter).slice(0, 200),
      });
      return { bars, errors };
    }
  }

  const iDate = idx(col.date);
  const iO = idx(col.open), iH = idx(col.high), iL = idx(col.low);
  const iC = idx(col.close), iV = idx(col.volume);
  const iTicker = col.ticker ? idx(col.ticker) : -1;
  const iName = col.name ? idx(col.name) : -1;
  const iSector = col.sector ? idx(col.sector) : -1;

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const line = r + 1; // 1-based, header is line 1
    const raw = cells.join(config.delimiter);

    // Blank line: skip silently? No — report as skipped per AC ("blank rows are
    // reported and skipped"). But a truly empty trailing cell array is noise;
    // treat an all-empty row as a blank row error.
    if (cells.every((x) => x.trim() === '')) {
      errors.push({ file: fileName, line, reason: 'blank row', sample: '' });
      continue;
    }

    const date = normalizeDate(cells[iDate] ?? '', config.dateFormat);
    const o = parseNum(cells[iO]);
    const h = parseNum(cells[iH]);
    const l = parseNum(cells[iL]);
    const c = parseNum(cells[iC]);
    const v = parseNum(cells[iV]);

    const rawTicker = iTicker >= 0 ? (cells[iTicker] ?? '').trim() : '';
    const ticker = rawTicker
      ? normalizeTicker(rawTicker, config.ticker)
      : fallbackTicker;

    const problems: string[] = [];
    if (date === null) problems.push(`bad date "${(cells[iDate] ?? '').trim()}"`);
    if (o === null) problems.push('bad open');
    if (h === null) problems.push('bad high');
    if (l === null) problems.push('bad low');
    if (c === null) problems.push('bad close');
    if (v === null) problems.push('bad volume');
    if (!ticker) problems.push('missing ticker');

    if (problems.length > 0) {
      errors.push({
        file: fileName, line,
        reason: problems.join(', '),
        sample: raw.slice(0, 200),
      });
      continue;
    }

    bars.push({
      ticker,
      date: date!,
      o: o!, h: h!, l: l!, c: c!, v: v!,
      name: iName >= 0 ? (cells[iName] ?? '').trim() || undefined : undefined,
      sector: iSector >= 0 ? (cells[iSector] ?? '').trim() || undefined : undefined,
    });
  }

  return { bars, errors };
}
