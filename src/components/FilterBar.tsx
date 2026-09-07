import { useScreener } from '../store';
import {
  AVG_VOL_PRESETS,
  MARKET_CAP_PRESETS,
  MIN_PRICE_PRESETS,
  EMA200_RISING_PRESETS,
  DEFAULT_FAN_FILTERS,
  filtersActive,
} from '../lib/filters';
import { useMemo } from 'react';
import { presets } from '../lib/strategy/presets';
import { HButton } from './ui/Hoverable';

const PRESET_OPTIONS = presets().map((s) => ({ label: s.name, value: s.id }));

const selectStyle = {
  padding: '7px 10px',
  border: '1px solid #e7e8ea',
  borderRadius: '9px',
  background: '#fff',
  color: '#3d4349',
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  minWidth: '118px',
} as const;

function FilterSelect({
  label,
  value,
  onChange,
  options,
  title,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  options: { label: string; value: string | number }[];
  title?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }} title={title}>
      <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#98a0a8' }}>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar() {
  const filters = useScreener((s) => s.filters);
  const sectors = useScreener((s) => s.sectors);
  const setFilter = useScreener((s) => s.setFilter);
  const resetFilters = useScreener((s) => s.resetFilters);
  const signalStrategy = useScreener((s) => s.signalStrategy);
  const setSignalStrategy = useScreener((s) => s.setSignalStrategy);
  const strategies = useScreener((s) => s.strategies);
  const active = filtersActive(filters);
  const entriesMode = signalStrategy !== '';

  const strategyOptions = useMemo(() => [
    { label: 'Fan lists (no entry)', value: '' },
    ...PRESET_OPTIONS,
    ...strategies.map((s) => ({ label: s.name, value: s.id })),
  ], [strategies]);

  const sectorOptions = [
    { label: 'All sectors', value: '' },
    ...sectors.map((s) => ({ label: s, value: s })),
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e7e8ea', flexWrap: 'wrap' }}>
      <FilterSelect
        label="Entry strategy"
        value={signalStrategy}
        onChange={(v) => setSignalStrategy(v)}
        options={strategyOptions}
        title="Show only names with a live open entry for the chosen strategy, with entry / stop / R / target. Leave off for the fan lists."
      />
      <FilterSelect
        label="Avg volume (20d)"
        value={filters.minAvgVol}
        onChange={(v) => setFilter('minAvgVol', Number(v))}
        options={AVG_VOL_PRESETS}
        title="Minimum 20-day average daily share volume"
      />
      <FilterSelect
        label="Market cap"
        value={filters.minMarketCap}
        onChange={(v) => setFilter('minMarketCap', Number(v))}
        options={MARKET_CAP_PRESETS}
        title="Minimum market cap when shares outstanding is known for the dataset"
      />
      <FilterSelect
        label="Min price"
        value={filters.minPrice}
        onChange={(v) => setFilter('minPrice', Number(v))}
        options={MIN_PRICE_PRESETS}
      />
      <FilterSelect
        label="Sector"
        value={filters.sector}
        onChange={(v) => setFilter('sector', v)}
        options={sectorOptions}
      />
      <FilterSelect
        label="200-EMA slope"
        value={filters.ema200RisingBars}
        onChange={(v) => setFilter('ema200RisingBars', Number(v))}
        options={EMA200_RISING_PRESETS}
        title="Keep names whose 200-day average is higher than it was 1, 3, or 5 months ago. 1 month is the usual minimum."
      />
      {active && (
        <HButton
          onClick={resetFilters}
          style={{ padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '9px', background: '#fafbfb', color: '#6b7280', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 1 }}
          hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
          title="Reset all filters"
        >
          Clear filters
        </HButton>
      )}
      <div style={{ flex: 1, minWidth: 8 }} />
      <div style={{ fontSize: '11px', color: '#98a0a8', paddingBottom: 8, maxWidth: 300, lineHeight: 1.4 }}>
        {entriesMode
          ? 'Entries: names with a live open trade for this strategy — 1R stop, 2.5–3R exit window. Volume, cap, and 200-EMA slope filter the scan.'
          : filters.minMarketCap > 0
            ? 'Cap filter applies only when shares outstanding is imported; other datasets may show fewer names.'
            : 'Filters apply to both lists after the fan screen. 200-EMA slope is on by default (1 month).'}
      </div>
    </div>
  );
}

export { DEFAULT_FAN_FILTERS };
