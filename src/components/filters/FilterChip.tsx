import { useEffect, useState } from 'react';
import {
  clauseActive,
  clauseValueLabel,
  EMA200_RISING_LOOKBACKS,
  barsLabel,
  formatFieldInput,
  parseFieldInput,
  QUICK_RANGES,
  unitHint,
  type Clause,
} from '../../lib/screen/filters';
import { fieldOf, type FieldId } from '../../lib/screen/fields';
import { HButton, HInput, HDiv } from '../ui/Hoverable';
import { LABEL, POPOVER, useDismiss } from './useDismiss';

/**
 * One filter chip: `Label  value  ×`. Clicking the label opens the editor for
 * the clause's kind — two bounds for a range, a checklist for the sector, the
 * three lookbacks for the 200-EMA slope — with the old dropdown presets kept as
 * one-click quick values. The chip keeps the field's `data-help` id, so the
 * hover cards written for the dropdowns still fire on their replacements.
 */
export function FilterChip({
  clause,
  autoOpen,
  onChange,
  onRemove,
  onOpened,
}: {
  clause: Clause;
  autoOpen?: boolean;
  onChange: (c: Clause) => void;
  onRemove: () => void;
  onOpened?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const wrap = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const field = fieldOf(clause.field as FieldId);
  const on = clauseActive(clause);

  useEffect(() => { if (open) onOpened?.(); }, [open, onOpened]);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <div
        data-help={field?.help}
        style={{
          display: 'flex', alignItems: 'stretch',
          border: `1px solid ${on ? '#b6e5d1' : '#e7e8ea'}`,
          background: on ? '#f2fbf7' : '#fff',
          borderRadius: 9, overflow: 'hidden',
        }}
      >
        <HButton
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={field?.title ?? field?.label}
          style={{
            display: 'flex', alignItems: 'baseline', gap: 6, padding: '6px 8px 6px 10px',
            border: 0, background: 'transparent', fontFamily: 'inherit',
            fontSize: 12, cursor: 'pointer', color: '#3d4349',
          }}
          hoverStyle={{ color: '#06865a' }}
        >
          <span style={{ fontWeight: 700 }}>{field?.label ?? clause.field}</span>
          <span style={{ color: on ? '#06865a' : '#98a0a8', fontWeight: 600 }}>{clauseValueLabel(clause)}</span>
        </HButton>
        <HButton
          onClick={onRemove}
          title="Remove this filter"
          aria-label={`Remove ${field?.label ?? clause.field} filter`}
          style={{
            border: 0, borderLeft: '1px solid #edeff0', background: 'transparent',
            padding: '0 7px', color: '#98a0a8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}
          hoverStyle={{ color: '#b3261a', background: '#fdeceb' }}
        >
          ×
        </HButton>
      </div>
      {open && (
        <div style={{ ...POPOVER, width: clause.kind === 'in' ? 210 : 250 }} data-help="filter-chip">
          {clause.kind === 'range' && (
            <RangeEditor clause={clause} onChange={onChange} onDone={() => setOpen(false)} />
          )}
          {clause.kind === 'in' && (
            <SectorEditor clause={clause} onChange={onChange} />
          )}
          {clause.kind === 'bars' && (
            <BarsEditor clause={clause} onChange={onChange} onDone={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px',
  border: '1px solid #e7e8ea', borderRadius: 7, background: '#fff',
  color: '#3d4349', fontSize: 12.5, fontFamily: 'inherit',
};

const quickStyle: React.CSSProperties = {
  padding: '4px 8px', border: '1px solid #e7e8ea', borderRadius: 7, background: '#fafbfb',
  color: '#6b7280', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
};

function RangeEditor({
  clause,
  onChange,
  onDone,
}: {
  clause: Extract<Clause, { kind: 'range' }>;
  onChange: (c: Clause) => void;
  onDone: () => void;
}) {
  const [min, setMin] = useState(() => formatFieldInput(clause.field, clause.min));
  const [max, setMax] = useState(() => formatFieldInput(clause.field, clause.max));
  const hint = unitHint(fieldOf(clause.field)?.kind ?? 'number');
  const quick = QUICK_RANGES[clause.field];

  const commit = () => {
    const lo = parseFieldInput(clause.field, min);
    const hi = parseFieldInput(clause.field, max);
    const next: Clause = { field: clause.field, kind: 'range' };
    if (lo != null) next.min = lo;
    if (hi != null) next.max = hi;
    onChange(next);
    onDone();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={LABEL}>Range {hint && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>({hint})</span>}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <HInput
          value={min}
          autoFocus
          placeholder="min"
          aria-label="Minimum"
          onChange={(e) => setMin(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          style={inputStyle}
          focusStyle={{ border: '1px solid #06a96b', outline: 'none' }}
        />
        <span style={{ color: '#98a0a8', fontSize: 12 }}>–</span>
        <HInput
          value={max}
          placeholder="max"
          aria-label="Maximum"
          onChange={(e) => setMax(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          style={inputStyle}
          focusStyle={{ border: '1px solid #06a96b', outline: 'none' }}
        />
      </div>
      {quick && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {quick.map((q) => (
            <HButton
              key={q.label}
              onClick={() => {
                setMin(q.min == null ? '' : String(q.min));
                setMax(q.max == null ? '' : String(q.max));
              }}
              style={quickStyle}
              hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
            >
              {q.label}
            </HButton>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11, color: '#98a0a8', lineHeight: 1.4 }}>
        Leave a box empty for an open end. Names with no value for this field are dropped.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <HButton
          onClick={commit}
          style={{ flex: 1, padding: '6px 10px', border: '1px solid #06a96b', borderRadius: 7, background: '#06a96b', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
          hoverStyle={{ background: '#06865a' }}
        >
          Apply
        </HButton>
        <HButton
          onClick={() => { setMin(''); setMax(''); onChange({ field: clause.field, kind: 'range' }); }}
          style={{ ...quickStyle, padding: '6px 10px' }}
          hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
        >
          Any
        </HButton>
      </div>
    </div>
  );
}

function SectorEditor({
  clause,
  onChange,
}: {
  clause: Extract<Clause, { kind: 'in' }>;
  onChange: (c: Clause) => void;
}) {
  const options = fieldOf('sector')?.options?.() ?? [];
  const toggle = (s: string) => {
    const values = clause.values.includes(s)
      ? clause.values.filter((v) => v !== s)
      : [...clause.values, s];
    onChange({ ...clause, values });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
      <div style={{ ...LABEL, padding: '0 2px 4px' }}>Sectors</div>
      {options.length === 0 && (
        <div style={{ fontSize: 11.5, color: '#98a0a8', padding: '0 2px 4px' }}>
          This dataset reports no sectors.
        </div>
      )}
      {options.map((s) => (
        <HDiv
          key={s}
          onClick={() => toggle(s)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer', color: '#3d4349' }}
          hoverStyle={{ background: '#f4f5f6' }}
        >
          <input type="checkbox" checked={clause.values.includes(s)} readOnly style={{ accentColor: '#06a96b', margin: 0 }} />
          <span>{s}</span>
        </HDiv>
      ))}
      {clause.values.length > 0 && (
        <HButton
          onClick={() => onChange({ ...clause, values: [] })}
          style={{ ...quickStyle, marginTop: 4, textAlign: 'left' }}
          hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
        >
          All sectors
        </HButton>
      )}
    </div>
  );
}

function BarsEditor({
  clause,
  onChange,
  onDone,
}: {
  clause: Extract<Clause, { kind: 'bars' }>;
  onChange: (c: Clause) => void;
  onDone: () => void;
}) {
  const pick = (bars: number) => { onChange({ ...clause, bars }); onDone(); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ ...LABEL, padding: '0 2px 4px' }}>200-EMA higher than</div>
      {EMA200_RISING_LOOKBACKS.map((n) => (
        <HDiv
          key={n}
          onClick={() => pick(n)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer', color: '#3d4349' }}
          hoverStyle={{ background: '#f4f5f6' }}
        >
          <input type="radio" checked={clause.bars === n} readOnly style={{ accentColor: '#06a96b', margin: 0 }} />
          <span>{barsLabel(n)} ago <span style={{ color: '#98a0a8' }}>({n} bars)</span></span>
        </HDiv>
      ))}
      <HDiv
        onClick={() => pick(0)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer', color: '#3d4349' }}
        hoverStyle={{ background: '#f4f5f6' }}
      >
        <input type="radio" checked={clause.bars === 0} readOnly style={{ accentColor: '#06a96b', margin: 0 }} />
        <span>Off — any slope</span>
      </HDiv>
    </div>
  );
}
