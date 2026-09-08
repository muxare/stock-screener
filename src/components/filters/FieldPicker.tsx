import { useMemo, useState } from 'react';
import { availableFields, type ScreenFilters } from '../../lib/screen/filters';
import type { FieldId } from '../../lib/screen/fields';
import { HButton, HDiv, HInput } from '../ui/Hoverable';
import { LABEL, POPOVER, useDismiss } from './useDismiss';

/**
 * The `+` chip: every filterable field the current set does not already use,
 * in registry order, with a type-ahead for the long tail. Picking one adds an
 * empty clause — the caller opens its editor straight away.
 */
export function FieldPicker({
  filters,
  onPick,
}: {
  filters: ScreenFilters;
  onPick: (id: FieldId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrap = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const fields = useMemo(() => {
    const all = availableFields(filters);
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((f) => f.label.toLowerCase().includes(needle)) : all;
  }, [filters, q]);

  const add = (id: FieldId) => { onPick(id); setOpen(false); setQ(''); };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <HButton
        data-help="filter-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Add a filter"
        aria-label="Add a filter"
        style={{
          padding: '6px 11px', border: '1px dashed #d7dade', borderRadius: 9,
          background: '#fff', color: '#6b7280', fontSize: 12, fontWeight: 700,
          fontFamily: 'inherit', cursor: 'pointer',
        }}
        hoverStyle={{ border: '1px dashed #06a96b', color: '#06865a' }}
      >
        + Filter
      </HButton>
      {open && (
        <div style={{ ...POPOVER, width: 216, maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ ...LABEL, padding: '0 2px 6px' }}>Add a filter</div>
          <HInput
            value={q}
            autoFocus
            placeholder="Search fields…"
            aria-label="Search fields"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && fields[0]) add(fields[0].id); }}
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #e7e8ea', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', color: '#3d4349', marginBottom: 6 }}
            focusStyle={{ border: '1px solid #06a96b', outline: 'none' }}
          />
          {fields.length === 0 && (
            <div style={{ fontSize: 11.5, color: '#98a0a8', padding: '4px 6px' }}>
              {q ? 'No field matches.' : 'Every field is already filtered.'}
            </div>
          )}
          {fields.map((f) => (
            <HDiv
              key={f.id}
              onClick={() => add(f.id)}
              title={f.title}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 6px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer', color: '#3d4349' }}
              hoverStyle={{ background: '#f4f5f6' }}
            >
              <span>{f.label}</span>
              <span style={{ color: '#c3c8cc', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.kind}</span>
            </HDiv>
          ))}
        </div>
      )}
    </div>
  );
}
