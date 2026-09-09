import { useCallback, useMemo, useState } from 'react';
import { useScreener } from '../store';
import {
  clausesActive,
  newClause,
  type Clause,
} from '../lib/screen/filters';
import type { FieldId } from '../lib/screen/fields';
import { presets } from '../lib/strategy/presets';
import { HButton } from './ui/Hoverable';
import { FilterChip } from './filters/FilterChip';
import { FieldPicker } from './filters/FieldPicker';
import { ScreenMenu } from './filters/ScreenMenu';

const PRESET_OPTIONS = presets().map((s) => ({ label: s.name, value: s.id }));

/** The uppercase caption over a control in this row. */
const fieldLabel = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#98a0a8',
} as const;

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
  help,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  options: { label: string; value: string | number }[];
  title?: string;
  help?: string;
}) {
  return (
    <label data-help={help} style={{ display: 'flex', flexDirection: 'column', gap: 4 }} title={title}>
      <span style={fieldLabel}>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * The filter bar: the entry-strategy select, then an open row of clause chips
 * and a `+` that adds any filterable field. A newly added chip opens its editor
 * immediately, so adding a filter and setting it is one gesture.
 */
export function FilterBar() {
  const filters = useScreener((s) => s.filters);
  const setClause = useScreener((s) => s.setClause);
  const removeClause = useScreener((s) => s.removeClause);
  const resetFilters = useScreener((s) => s.resetFilters);
  const signalStrategy = useScreener((s) => s.signalStrategy);
  const setSignalStrategy = useScreener((s) => s.setSignalStrategy);
  const strategies = useScreener((s) => s.strategies);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const active = clausesActive(filters);

  const strategyOptions = useMemo(() => [
    { label: 'Fan lists (no entry)', value: '' },
    ...PRESET_OPTIONS,
    ...strategies.map((s) => ({ label: s.name, value: s.id })),
  ], [strategies]);

  const addField = useCallback((id: FieldId) => {
    setClause(newClause(id));
    setJustAdded(id);
  }, [setClause]);

  const clearAdded = useCallback(() => setJustAdded(null), []);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e7e8ea', flexWrap: 'wrap' }}>
      <FilterSelect
        label="Entry strategy"
        help="entry-strategy"
        value={signalStrategy}
        onChange={(v) => setSignalStrategy(v)}
        options={strategyOptions}
        title="Show only names with a live open entry for the chosen strategy, with entry / stop / R / target. Leave off for the fan lists."
      />

      {/* The caption owns `filters`, not the row. The row is the widest target
          on the screen and mostly gaps between chips, each of which documents
          itself; a heading beside the Entry-strategy label is a word you can
          point at deliberately. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span data-help="filters" style={{ ...fieldLabel, alignSelf: 'flex-start', cursor: 'help' }}>Filters</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', paddingBottom: 1 }}>
          {filters.clauses.map((c: Clause) => (
            <FilterChip
              key={c.field}
              clause={c}
              autoOpen={justAdded === c.field}
              onOpened={justAdded === c.field ? clearAdded : undefined}
              onChange={setClause}
              onRemove={() => removeClause(c.field)}
            />
          ))}
          <FieldPicker filters={filters} onPick={addField} />
          {active && (
            <HButton
              onClick={resetFilters}
              style={{ padding: '6px 11px', border: '1px solid #e7e8ea', borderRadius: 9, background: '#fafbfb', color: '#6b7280', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
              title="Reset all filters"
            >
              Clear filters
            </HButton>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 8 }} />
      <ScreenMenu />
    </div>
  );
}
