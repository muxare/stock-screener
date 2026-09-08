// screen/fields.ts — the one table that drives the screener's columns.
//
// A field is declared once here and the header label, the alignment, the
// column width, the cell format, the sort value, the help topic and (from
// phase 2) the filter chip all come from that declaration. Adding a column is
// adding a row to FIELD_LIST — no grid template, no per-table switch.
//
// Units are the subtle part, so the `kind` owns them:
//   price   — currency-ish number, 2 decimals
//   percent — ALREADY in percent units (changePct 1.2 means +1.2%)
//   ratio   — a FRACTION rendered as a percent (worstGap 0.0025 → "0.25%")
//   compact — big counts, 1.2M / 3.4B
//   number  — plain, `digits` decimals
//   enum    — a string from a fixed set (sector)
//   text    — free text (ticker, name)
//   spark   — the 40-day sparkline, drawn not formatted

import type { IndicatorSnapshot } from './snapshot.ts';
import { DASH, fmtCompact, fmtFixed, fmtPercent, fmtRatio, isNum } from './format.ts';

export type FieldId =
  | 'ticker' | 'name' | 'sector'
  | 'price' | 'changePct'
  | 'volume' | 'relVol' | 'avgVol20' | 'marketCap'
  | 'ema18' | 'ema50' | 'ema100' | 'ema200' | 'worstGap'
  | 'rsi14' | 'stochK' | 'stochD'
  | 'perf1m' | 'perf3m' | 'atrPct'
  | 'hi52' | 'lo52'
  | 'sparkline'
  | 'ema200Rising';

export type FieldKind = 'text' | 'enum' | 'number' | 'price' | 'percent' | 'ratio' | 'compact' | 'spark' | 'bars';

/**
 * The shape every screener row satisfies: the intersection of `FanRow` and
 * `FanSignalRow`, plus the fan-only fields as optionals so one table serves
 * both lists.
 */
export interface ScreenRowLike {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  avgVol20: number;
  marketCap: number | null;
  snapshot: IndicatorSnapshot;
  relVol?: number;
  ema18?: number;
  ema50?: number;
  ema100?: number;
  ema200?: number;
  worstGap?: number;
  sparkline?: number[];
}

export interface FieldDef {
  id: FieldId;
  label: string;
  kind: FieldKind;
  /** Sort key and formatter input. null = missing (always sorts last). */
  get: (row: ScreenRowLike) => number | string | null;
  /** Glossary topic id behind the header's hover card. */
  help?: string;
  align: 'left' | 'right';
  /** CSS grid track, e.g. '84px' or '1fr'. */
  width: string;
  defaultVisible: boolean;
  /** Can be shown as a table column (false = filter-only). */
  column: boolean;
  /** Offered as a filter chip (phase 2). */
  filterable: boolean;
  /** Never hidden by the column chooser. */
  pinned?: boolean;
  /** Decimals for `number` / `price` kinds. */
  digits?: number;
  /** Header tooltip. */
  title?: string;
  /** enum only: the values a filter may pick from (see `setSectorOptions`). */
  options?: () => string[];
}

/**
 * Where an `enum` field's choices come from. The sectors are a property of the
 * loaded dataset, not of the registry, so the store supplies them once at
 * start-up and the field just asks. Defaults to none so the registry stays
 * usable (and testable) with no store around.
 */
let sectorSource: () => readonly string[] = () => [];

export function setSectorOptions(fn: () => readonly string[]): void {
  sectorSource = fn;
}

const snap = <K extends keyof IndicatorSnapshot>(k: K) => (r: ScreenRowLike) => {
  const v = r.snapshot?.[k];
  return isNum(v) ? v : null;
};
const numOf = (v: number | null | undefined) => (isNum(v) ? v : null);

const FIELD_LIST: FieldDef[] = [
  { id: 'ticker', label: 'Ticker', kind: 'text', align: 'left', width: '86px', defaultVisible: true, column: true, filterable: false, pinned: true, get: (r) => r.ticker },
  { id: 'name', label: 'Name', kind: 'text', align: 'left', width: 'minmax(120px, 1fr)', defaultVisible: true, column: true, filterable: false, get: (r) => r.name },
  { id: 'sector', label: 'Sector', kind: 'enum', help: 'sector', align: 'left', width: '132px', defaultVisible: false, column: true, filterable: true, options: () => [...sectorSource()], get: (r) => r.sector || null },

  { id: 'price', label: 'Last', kind: 'price', help: 'min-price', align: 'right', width: '72px', defaultVisible: true, column: true, filterable: true, digits: 2, get: (r) => numOf(r.price) },
  { id: 'changePct', label: 'Chg', kind: 'percent', help: 'change-pct', align: 'right', width: '66px', defaultVisible: true, column: true, filterable: true, get: (r) => numOf(r.changePct) },

  { id: 'volume', label: 'Volume', kind: 'compact', help: 'volume', align: 'right', width: '80px', defaultVisible: false, column: true, filterable: true, title: 'Shares traded on the last bar', get: snap('volume') },
  { id: 'relVol', label: 'Rel vol', kind: 'number', help: 'rel-vol', align: 'right', width: '72px', defaultVisible: true, column: true, filterable: true, digits: 2, title: 'Last-bar volume ÷ 20-day average volume', get: (r) => {
    if (isNum(r.relVol)) return r.relVol;
    const v = r.snapshot?.volume;
    return isNum(v) && isNum(r.avgVol20) && r.avgVol20 > 0 ? v / r.avgVol20 : null;
  } },
  { id: 'avgVol20', label: 'Avg vol', kind: 'compact', help: 'avg-volume', align: 'right', width: '80px', defaultVisible: true, column: true, filterable: true, title: '20-day average daily share volume', get: (r) => numOf(r.avgVol20) },
  { id: 'marketCap', label: 'Mkt cap', kind: 'compact', help: 'market-cap', align: 'right', width: '84px', defaultVisible: true, column: true, filterable: true, get: (r) => numOf(r.marketCap) },

  { id: 'ema18', label: 'EMA18', kind: 'price', help: 'ema', align: 'right', width: '78px', defaultVisible: true, column: true, filterable: false, digits: 2, get: (r) => numOf(r.ema18) },
  { id: 'ema50', label: 'EMA50', kind: 'price', help: 'ema', align: 'right', width: '78px', defaultVisible: true, column: true, filterable: false, digits: 2, get: (r) => numOf(r.ema50) },
  { id: 'ema100', label: 'EMA100', kind: 'price', help: 'ema', align: 'right', width: '78px', defaultVisible: true, column: true, filterable: false, digits: 2, get: (r) => numOf(r.ema100) },
  { id: 'ema200', label: 'EMA200', kind: 'price', help: 'ema', align: 'right', width: '78px', defaultVisible: true, column: true, filterable: false, digits: 2, get: (r) => numOf(r.ema200) },
  { id: 'worstGap', label: 'Gap', kind: 'ratio', help: 'worst-gap', align: 'right', width: '76px', defaultVisible: true, column: true, filterable: true, get: (r) => numOf(r.worstGap) },

  { id: 'rsi14', label: 'RSI 14', kind: 'number', help: 'rsi', align: 'right', width: '68px', defaultVisible: true, column: true, filterable: true, digits: 1, get: snap('rsi14') },
  { id: 'stochK', label: 'Stoch %K', kind: 'number', help: 'stoch-rsi', align: 'right', width: '80px', defaultVisible: true, column: true, filterable: true, digits: 1, get: snap('stochK') },
  { id: 'stochD', label: 'Stoch %D', kind: 'number', help: 'stoch-rsi', align: 'right', width: '80px', defaultVisible: false, column: true, filterable: true, digits: 1, get: snap('stochD') },

  { id: 'perf1m', label: 'Perf 1M', kind: 'ratio', help: 'perf', align: 'right', width: '76px', defaultVisible: false, column: true, filterable: true, title: 'Close vs. the close 21 trading days ago', get: snap('perf1m') },
  { id: 'perf3m', label: 'Perf 3M', kind: 'ratio', help: 'perf', align: 'right', width: '76px', defaultVisible: false, column: true, filterable: true, title: 'Close vs. the close 63 trading days ago', get: snap('perf3m') },
  { id: 'atrPct', label: 'Volatility', kind: 'ratio', help: 'atr-pct', align: 'right', width: '82px', defaultVisible: false, column: true, filterable: true, title: 'ATR(14) as a percent of the last close', get: snap('atrPct') },

  { id: 'hi52', label: '52w high', kind: 'price', help: 'week52', align: 'right', width: '80px', defaultVisible: false, column: true, filterable: true, digits: 2, get: snap('hi52') },
  { id: 'lo52', label: '52w low', kind: 'price', help: 'week52', align: 'right', width: '80px', defaultVisible: false, column: true, filterable: true, digits: 2, get: snap('lo52') },

  { id: 'sparkline', label: '40d', kind: 'spark', help: 'sparkline', align: 'right', width: '92px', defaultVisible: true, column: true, filterable: false, get: () => null },

  // Filter-only: a slope test over `ema200Ago`, not a value to show. Phase 2
  // turns it into the bars clause; it is here so the chip list is one registry.
  { id: 'ema200Rising', label: '200-EMA slope', kind: 'bars', help: 'ema200-slope', align: 'right', width: '0px', defaultVisible: false, column: false, filterable: true, get: () => null },
];

export const FIELDS: ReadonlyMap<FieldId, FieldDef> = new Map(FIELD_LIST.map((f) => [f.id, f]));

/** Every field, declaration order — the order the column chooser lists them in. */
export const ALL_FIELDS: readonly FieldDef[] = FIELD_LIST;

/** Fields that can be shown as a column, declaration order. */
export const COLUMN_FIELDS: readonly FieldDef[] = FIELD_LIST.filter((f) => f.column);

export function fieldOf(id: FieldId): FieldDef | undefined {
  return FIELDS.get(id);
}

export function isFieldId(id: string): id is FieldId {
  return FIELDS.has(id as FieldId);
}

export function fieldWidth(id: FieldId): string {
  return FIELDS.get(id)?.width ?? '80px';
}

/** The cell text for `id` on `row`. Sparkline cells are drawn, not formatted. */
export function formatField(id: FieldId, row: ScreenRowLike): string {
  const f = FIELDS.get(id);
  if (!f) return DASH;
  const v = f.get(row);
  if (v == null) return DASH;
  if (typeof v === 'string') return v;
  switch (f.kind) {
    case 'compact': return fmtCompact(v);
    case 'percent': return fmtPercent(v);
    case 'ratio': return fmtRatio(v);
    case 'price': return fmtFixed(v, f.digits ?? 2);
    case 'number': return fmtFixed(v, f.digits ?? 2);
    default: return String(v);
  }
}

/** Sort/filter value for `id` on `row`. */
export function valueOfField(id: FieldId, row: ScreenRowLike): number | string | null {
  return FIELDS.get(id)?.get(row) ?? null;
}
