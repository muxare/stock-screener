// screen/filters.ts — the screener's filter model.
//
// Replaces the five fixed dropdowns of lib/filters.ts with an open list of
// clauses, one per field, so any filterable field in the registry can become a
// chip. The model is data: the chip bar renders it, `applyClauses` evaluates
// it, `signalFloorsOf` projects the three floors the /signals scan takes, and
// (phase 4) a saved screen is little more than this object plus a name.
//
// Two rules the whole file turns on:
//
//   * **Units follow the field's `kind`, never the field.** A `ratio` field
//     holds a fraction and its chip is typed in percent — "2.5" is stored as
//     0.025. A `percent` field is ALREADY in percent units, so changePct's
//     "2.5" is stored as 2.5. Clause values are always in the field's native
//     units; `parseFieldInput` / `formatFieldInput` are the only conversion.
//   * **A range clause drops rows whose value is missing**, whichever bound is
//     set. `snapshot` fields are NaN when the history is too short (and null
//     once they have crossed JSON), so "RSI 14 50–65" has nothing to compare on
//     a freshly listed name. Dropping matches the market-cap behaviour the
//     lists already had, and matches TradingView. Sorting keeps the opposite
//     convention on purpose: missing sinks to the bottom but stays in the list.

import {
  ALL_FIELDS,
  fieldOf,
  valueOfField,
  type FieldDef,
  type FieldId,
  type FieldKind,
  type ScreenRowLike,
} from './fields.ts';
import { fmtCompact, isNum, parseCompact } from './format.ts';

/** Trading days the 200-EMA slope test looks back over. */
export const EMA200_RISING_LOOKBACKS = [21, 63, 105] as const;
export type Ema200RisingBars = (typeof EMA200_RISING_LOOKBACKS)[number];

export type Clause =
  /** Numeric window on any filterable field; either bound may be absent. */
  | { field: FieldId; kind: 'range'; min?: number; max?: number }
  /** Sector membership; an empty list means "any". */
  | { field: 'sector'; kind: 'in'; values: string[] }
  /** The 200-EMA slope test. 0 = off. */
  | { field: 'ema200Rising'; kind: 'bars'; bars: number };

export interface ScreenFilters {
  clauses: Clause[];
}

/**
 * What `applyClauses` needs beyond a screener row: the 200-EMA lookbacks, which
 * only fan rows carry. An entries row has no `ema200Ago` — the engine already
 * enforced the slope at the fill — so the slope clause passes it through.
 */
export interface FilterRow extends ScreenRowLike {
  ema200Ago?: Record<Ema200RisingBars, number | null> | null;
}

export const DEFAULT_EMA200_RISING_BARS = 21;

/** Today's behaviour: the 1-month slope test on, nothing else. */
export function defaultFilters(): ScreenFilters {
  return { clauses: [{ field: 'ema200Rising', kind: 'bars', bars: DEFAULT_EMA200_RISING_BARS }] };
}

export const DEFAULT_FILTERS: ScreenFilters = defaultFilters();

// ---------------------------------------------------------------- units

/** Chip units → the field's native units. Only `ratio` differs. */
export function toNative(kind: FieldKind, n: number): number {
  return kind === 'ratio' ? n / 100 : n;
}

/** Native units → the units the chip shows and accepts. */
export function fromNative(kind: FieldKind, n: number): number {
  return kind === 'ratio' ? n * 100 : n;
}

/** Parse what the user typed into a clause bound, or null when it is not a number. */
export function parseFieldInput(id: FieldId, text: string): number | null {
  const f = fieldOf(id);
  if (!f) return null;
  const n = parseCompact(text);
  return n == null ? null : toNative(f.kind, n);
}

/** The editable text for a clause bound already in native units. */
export function formatFieldInput(id: FieldId, v: number | undefined): string {
  const f = fieldOf(id);
  if (f == null || !isNum(v)) return '';
  const shown = fromNative(f.kind, v);
  if (f.kind === 'compact') return fmtCompact(shown);
  return String(Number(shown.toFixed(4)));
}

/** The unit written next to the inputs in a chip's editor. */
export function unitHint(kind: FieldKind): string {
  if (kind === 'ratio' || kind === 'percent') return '%';
  if (kind === 'compact') return 'e.g. 400K, 1.2B';
  return '';
}

// ---------------------------------------------------------------- clause list

export function clauseOf(f: ScreenFilters, field: string): Clause | undefined {
  return f.clauses.find((c) => c.field === field);
}

/** The empty clause a newly added chip starts from. */
export function newClause(field: FieldId): Clause {
  if (field === 'sector') return { field: 'sector', kind: 'in', values: [] };
  if (field === 'ema200Rising') return { field: 'ema200Rising', kind: 'bars', bars: DEFAULT_EMA200_RISING_BARS };
  return { field, kind: 'range' };
}

/** Replace the clause on `c.field`, or append it. Order is the order chips were added. */
export function setClause(f: ScreenFilters, c: Clause): ScreenFilters {
  const at = f.clauses.findIndex((x) => x.field === c.field);
  const clauses = at >= 0 ? f.clauses.map((x, i) => (i === at ? c : x)) : [...f.clauses, c];
  return { clauses };
}

export function removeClause(f: ScreenFilters, field: string): ScreenFilters {
  return { clauses: f.clauses.filter((c) => c.field !== field) };
}

/** Fields that may become a chip, registry order, minus the ones already on. */
export function availableFields(f: ScreenFilters): FieldDef[] {
  const used = new Set(f.clauses.map((c) => c.field as string));
  return ALL_FIELDS.filter((d) => d.filterable && !used.has(d.id));
}

/** A clause that narrows nothing (both bounds empty, no sectors, slope off). */
export function clauseActive(c: Clause): boolean {
  switch (c.kind) {
    case 'range': return isNum(c.min) || isNum(c.max);
    case 'in': return c.values.length > 0;
    case 'bars': return c.bars > 0;
  }
}

function isDefaultSlope(c: Clause): boolean {
  return c.kind === 'bars' && c.bars === DEFAULT_EMA200_RISING_BARS;
}

/**
 * Does the current set trim the lists relative to the default? The default
 * slope clause does not count — it is on out of the box — but every other
 * active clause does, including one that only drops rows for a missing value,
 * so the "n of m shown" line always has a reason to point at.
 */
export function clausesActive(f: ScreenFilters): boolean {
  return f.clauses.some((c) => clauseActive(c) && !isDefaultSlope(c));
}

// ---------------------------------------------------------------- evaluation

function slopeRising(row: FilterRow, bars: number): boolean {
  const ago = row.ema200Ago;
  if (ago == null) return true; // entries rows: already enforced by the scan
  const then = ago[bars as Ema200RisingBars];
  if (!isNum(then)) return false;
  return isNum(row.ema200) && row.ema200 > then;
}

export function rowPasses(row: FilterRow, c: Clause): boolean {
  switch (c.kind) {
    case 'bars':
      return slopeRising(row, c.bars);
    case 'in':
      return c.values.includes(row.sector);
    case 'range': {
      const v = valueOfField(c.field, row);
      if (!isNum(v)) return false; // missing loses, whichever bound is set
      if (isNum(c.min) && v < c.min) return false;
      if (isNum(c.max) && v > c.max) return false;
      return true;
    }
  }
}

export function applyClauses<T extends FilterRow>(rows: readonly T[], f: ScreenFilters): T[] {
  const active = f.clauses.filter(clauseActive);
  if (active.length === 0) return rows.slice();
  return rows.filter((r) => active.every((c) => rowPasses(r, c)));
}

export function matchesSearch(row: { ticker: string; name: string }, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return row.ticker.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
}

/** The clauses plus the search box — what every list shows. */
export function filterRows<T extends FilterRow>(
  rows: readonly T[],
  search: string,
  f: ScreenFilters,
): T[] {
  return applyClauses(rows, f).filter((r) => matchesSearch(r, search));
}

// ---------------------------------------------------------------- /signals floors

export interface SignalFloors {
  minAvgVol: number;
  minMarketCap: number;
  ema200RisingBars: number;
}

/**
 * The three floors the /signals scan takes server-side, derived from the
 * clauses. Everything else in the filter set is applied to the rows it returns.
 */
export function signalFloorsOf(f: ScreenFilters): SignalFloors {
  const floors: SignalFloors = { minAvgVol: 0, minMarketCap: 0, ema200RisingBars: 0 };
  for (const c of f.clauses) {
    if (!clauseActive(c)) continue;
    if (c.kind === 'bars') floors.ema200RisingBars = c.bars;
    else if (c.kind === 'range' && isNum(c.min)) {
      if (c.field === 'avgVol20') floors.minAvgVol = c.min;
      if (c.field === 'marketCap') floors.minMarketCap = c.min;
    }
  }
  return floors;
}

export function floorsEqual(a: SignalFloors, b: SignalFloors): boolean {
  return a.minAvgVol === b.minAvgVol
    && a.minMarketCap === b.minMarketCap
    && a.ema200RisingBars === b.ema200RisingBars;
}

// ---------------------------------------------------------------- labels

const BARS_LABEL: Record<number, string> = { 21: '1 month', 63: '3 months', 105: '5 months' };

export function barsLabel(bars: number): string {
  return BARS_LABEL[bars] ?? `${bars} bars`;
}

/** The right-hand half of a chip: what the clause is set to. */
export function clauseValueLabel(c: Clause): string {
  switch (c.kind) {
    case 'bars':
      return c.bars > 0 ? `rising ≥ ${barsLabel(c.bars)}` : 'any';
    case 'in':
      if (c.values.length === 0) return 'any';
      if (c.values.length === 1) return c.values[0];
      return `${c.values[0]} +${c.values.length - 1}`;
    case 'range': {
      const lo = formatFieldInput(c.field, c.min);
      const hi = formatFieldInput(c.field, c.max);
      const kind = fieldOf(c.field)?.kind;
      const suffix = kind === 'ratio' || kind === 'percent' ? '%' : '';
      if (lo && hi) return `${lo}–${hi}${suffix}`;
      if (lo) return `≥ ${lo}${suffix}`;
      if (hi) return `≤ ${hi}${suffix}`;
      return 'any';
    }
  }
}

export function clauseLabel(c: Clause): string {
  const f = fieldOf(c.field as FieldId);
  return `${f?.label ?? c.field} ${clauseValueLabel(c)}`;
}

// ---------------------------------------------------------------- quick values

export interface FilterPreset {
  label: string;
  value: number;
}

/**
 * The old dropdown presets, still offered — as one-click buttons inside a
 * chip's editor rather than as the only choices. The `Any …` entries survive
 * because the backtest modal still uses these arrays as selects.
 */
export const AVG_VOL_PRESETS: FilterPreset[] = [
  { label: 'Any avg volume', value: 0 },
  { label: '≥ 100K', value: 100_000 },
  { label: '≥ 250K', value: 250_000 },
  { label: '≥ 500K', value: 500_000 },
  { label: '≥ 1M', value: 1_000_000 },
];

export const MARKET_CAP_PRESETS: FilterPreset[] = [
  { label: 'Any market cap', value: 0 },
  { label: '≥ $300M', value: 300_000_000 },
  { label: '≥ $1B', value: 1_000_000_000 },
  { label: '≥ $5B', value: 5_000_000_000 },
  { label: '≥ $10B', value: 10_000_000_000 },
];

export const MIN_PRICE_PRESETS: FilterPreset[] = [
  { label: 'Any price', value: 0 },
  { label: '≥ $1', value: 1 },
  { label: '≥ $5', value: 5 },
  { label: '≥ $10', value: 10 },
  { label: '≥ $20', value: 20 },
];

/** 21 / 63 / 105 trading days ≈ 1 / 3 / 5 calendar months. */
export const EMA200_RISING_PRESETS: FilterPreset[] = [
  { label: 'Any 200-EMA slope', value: 0 },
  ...EMA200_RISING_LOOKBACKS.map((n) => ({ label: `Rising ≥ ${barsLabel(n)}`, value: n as number })),
];

/** Quick min/max buttons offered inside a range chip's editor, in chip units. */
export const QUICK_RANGES: Partial<Record<FieldId, { label: string; min?: number; max?: number }[]>> = {
  avgVol20: [
    { label: '≥ 100K', min: 100_000 },
    { label: '≥ 250K', min: 250_000 },
    { label: '≥ 500K', min: 500_000 },
    { label: '≥ 1M', min: 1_000_000 },
  ],
  marketCap: [
    { label: '≥ 300M', min: 300_000_000 },
    { label: '≥ 1B', min: 1_000_000_000 },
    { label: '≥ 5B', min: 5_000_000_000 },
    { label: '≥ 10B', min: 10_000_000_000 },
  ],
  price: [
    { label: '≥ 1', min: 1 },
    { label: '≥ 5', min: 5 },
    { label: '≥ 10', min: 10 },
    { label: '20–100', min: 20, max: 100 },
  ],
  rsi14: [
    { label: 'Oversold ≤ 30', max: 30 },
    { label: '50–65', min: 50, max: 65 },
    { label: 'Overbought ≥ 70', min: 70 },
  ],
  stochK: [
    { label: '≤ 20', max: 20 },
    { label: '≥ 80', min: 80 },
  ],
  relVol: [
    { label: '≥ 1.5', min: 1.5 },
    { label: '≥ 2', min: 2 },
  ],
};
