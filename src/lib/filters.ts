import type { Ema200Ago, FanRow } from './fan';

// Moved to screen/format.ts (the table and the filter chips share it); still
// exported from here for the existing callers.
export { fmtCompact } from './screen/format';

export interface FanFilters {
  minAvgVol: number;
  minMarketCap: number;
  minPrice: number;
  sector: string;
  /** Trading days the 200-EMA must be higher than today. 0 = off. */
  ema200RisingBars: number;
}

export const DEFAULT_FAN_FILTERS: FanFilters = {
  minAvgVol: 0,
  minMarketCap: 0,
  minPrice: 0,
  sector: '',
  ema200RisingBars: 21,
};

export interface FilterPreset {
  label: string;
  value: number;
}

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
  { label: 'Rising ≥ 1 month', value: 21 },
  { label: 'Rising ≥ 3 months', value: 63 },
  { label: 'Rising ≥ 5 months', value: 105 },
];

export function filtersActive(f: FanFilters): boolean {
  return f.minAvgVol !== DEFAULT_FAN_FILTERS.minAvgVol
    || f.minMarketCap !== DEFAULT_FAN_FILTERS.minMarketCap
    || f.minPrice !== DEFAULT_FAN_FILTERS.minPrice
    || f.sector !== DEFAULT_FAN_FILTERS.sector
    || f.ema200RisingBars !== DEFAULT_FAN_FILTERS.ema200RisingBars;
}

export function applyFanFilters(rows: FanRow[], f: FanFilters): FanRow[] {
  return rows.filter((r) => {
    if (f.sector && r.sector !== f.sector) return false;
    if (f.minPrice > 0 && (!Number.isFinite(r.price) || r.price < f.minPrice)) return false;
    if (f.minAvgVol > 0 && (!Number.isFinite(r.avgVol20) || r.avgVol20 < f.minAvgVol)) return false;
    if (f.minMarketCap > 0) {
      if (r.marketCap == null || !Number.isFinite(r.marketCap) || r.marketCap < f.minMarketCap) return false;
    }
    if (f.ema200RisingBars > 0) {
      const n = f.ema200RisingBars as keyof Ema200Ago;
      const then = r.ema200Ago?.[n];
      if (then == null || !Number.isFinite(then) || !(r.ema200 > then)) return false;
    }
    return true;
  });
}

export function filterFanRows(rows: FanRow[], search: string, f: FanFilters): FanRow[] {
  const q = search.trim().toLowerCase();
  const filtered = applyFanFilters(rows, f);
  if (!q) return filtered;
  return filtered.filter((r) => r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
}
