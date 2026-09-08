import { useEffect, useRef, useState } from 'react';
import { COLUMN_FIELDS, type FieldId } from '../../lib/screen/fields';
import { HButton, HDiv } from '../ui/Hoverable';

/**
 * ColumnChooser — the ⚙ next to a list header. A checklist of every field that
 * can be a column, in registry order; pinned fields (the ticker) are shown but
 * cannot be turned off. Visibility itself lives in the store, per view.
 */
export function ColumnChooser({
  columns,
  onToggle,
  onReset,
}: {
  columns: FieldId[];
  onToggle: (id: FieldId) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <HButton
        data-help="column-chooser"
        onClick={() => setOpen((v) => !v)}
        title="Choose columns"
        aria-label="Choose columns"
        aria-expanded={open}
        style={{
          width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid #e7e8ea', borderRadius: 7, background: open ? '#f0f1f2' : '#fff',
          color: '#6b7280', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
        }}
        hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
      >
        ⚙
      </HButton>
      {open && (
        <div
          style={{
            position: 'absolute', top: 30, right: 0, zIndex: 20, width: 210,
            maxHeight: 340, overflowY: 'auto',
            background: '#fff', border: '1px solid #e7e8ea', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15, 20, 25, 0.14)', padding: 6,
          }}
        >
          <div style={{ padding: '4px 8px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#98a0a8' }}>
            Columns
          </div>
          {COLUMN_FIELDS.map((f) => {
            const on = columns.includes(f.id);
            return (
              <HDiv
                key={f.id}
                onClick={() => { if (!f.pinned) onToggle(f.id); }}
                title={f.pinned ? 'Always shown' : f.title}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6,
                  fontSize: 12.5, color: f.pinned ? '#98a0a8' : '#3d4349',
                  cursor: f.pinned ? 'default' : 'pointer',
                }}
                hoverStyle={f.pinned ? undefined : { background: '#f4f5f6' }}
              >
                <input type="checkbox" checked={on} readOnly disabled={f.pinned} style={{ accentColor: '#06a96b', margin: 0 }} />
                <span>{f.label}</span>
              </HDiv>
            );
          })}
          <div style={{ borderTop: '1px solid #f0f1f2', marginTop: 6, paddingTop: 6 }}>
            <HButton
              onClick={onReset}
              style={{
                width: '100%', padding: '6px 8px', border: 0, borderRadius: 6, background: '#fff',
                color: '#6b7280', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
              }}
              hoverStyle={{ background: '#f4f5f6', color: '#06865a' }}
            >
              Reset to defaults
            </HButton>
          </div>
        </div>
      )}
    </div>
  );
}
