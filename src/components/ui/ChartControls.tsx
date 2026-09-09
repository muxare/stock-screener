import { useCallback, useState, type CSSProperties } from 'react';
import { GROUP_LABEL, PATTERNS, type PatternGroup, type PatternId } from '../../lib/patterns';
import { useDismiss } from '../filters/useDismiss';
import { HButton, HDiv } from './Hoverable';

const base: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 7,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
  lineHeight: 1,
};

const pill = (active: boolean): CSSProperties => ({
  ...base,
  border: '1px solid ' + (active ? '#c7d8ff' : '#e7e8ea'),
  background: active ? '#eef3ff' : '#fff',
  color: active ? '#2b62d6' : '#6b7280',
});

const icon = (enabled: boolean): CSSProperties => ({
  ...base,
  minWidth: 28,
  textAlign: 'center',
  border: '1px solid #e7e8ea',
  background: '#fff',
  color: enabled ? '#5b6168' : '#c4c8cc',
  cursor: enabled ? 'pointer' : 'default',
});

/**
 * What the price-action chooser needs from its host: which detectors are on,
 * how many of each fall inside the window on screen, and the two callbacks.
 * Charts that do not draw patterns leave the whole prop off.
 */
export interface PatternControl {
  selected: readonly PatternId[];
  /** markers per pattern id inside the visible bar range */
  counts: Record<string, number>;
  onToggle: (id: PatternId) => void;
  onAll: (on: boolean) => void;
}

const GROUPS: PatternGroup[] = ['structure', 'reversal', 'bar'];

/**
 * PatternChooser — the "Patterns" pill. A checklist of every detector in
 * lib/patterns.ts, grouped, each with the number of markers currently in view
 * so an empty selection is obviously empty rather than mysteriously blank.
 */
function PatternChooser({ selected, counts, onToggle, onAll }: PatternControl) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const wrap = useDismiss<HTMLDivElement>(open, close);
  const on = selected.length;

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <HButton
        data-help="price-action"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Choose price-action patterns"
        style={pill(on > 0)}
        hoverStyle={{ background: on > 0 ? '#e4edff' : '#f7f8f8' }}
      >
        Patterns{on > 0 ? ` · ${on}` : ''} ▾
      </HButton>
      {open && (
        <div
          style={{
            position: 'absolute', top: 28, left: 0, zIndex: 30, width: 258,
            maxHeight: 430, overflowY: 'auto',
            background: '#fff', border: '1px solid #e7e8ea', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15, 20, 25, 0.14)', padding: 6,
          }}
        >
          {GROUPS.map((g) => (
            <div key={g}>
              <div style={{ padding: '6px 8px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#98a0a8' }}>
                {GROUP_LABEL[g]}
              </div>
              {PATTERNS.filter((p) => p.group === g).map((p) => {
                const checked = selected.includes(p.id);
                const n = counts[p.id] ?? 0;
                return (
                  <HDiv
                    key={p.id}
                    data-help={p.help}
                    onClick={() => onToggle(p.id)}
                    title={p.blurb}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                      borderRadius: 6, fontSize: 12.5, color: '#3d4349', cursor: 'pointer',
                    }}
                    hoverStyle={{ background: '#f4f5f6' }}
                  >
                    <input type="checkbox" checked={checked} readOnly style={{ accentColor: '#06a96b', margin: 0 }} />
                    <span style={{ flex: 1 }}>{p.label}</span>
                    <span style={{ fontSize: 11, color: n ? '#6b7280' : '#c4c8cc', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                  </HDiv>
                );
              })}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #f0f1f2', marginTop: 6, paddingTop: 6 }}>
            {([['Show all', true], ['Clear', false]] as const).map(([label, all]) => (
              <HButton
                key={label}
                onClick={() => onAll(all)}
                style={{
                  flex: 1, padding: '6px 8px', border: 0, borderRadius: 6, background: '#fff',
                  color: '#6b7280', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                }}
                hoverStyle={{ background: '#f4f5f6', color: '#06865a' }}
              >
                {label}
              </HButton>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Control strip shared by the candlestick charts: MACD / Stoch RSI toggles and
 * the price-action pattern chooser on the left, zoom + reset controls on the
 * right, with a hint about the scroll-to-zoom / drag-to-pan gestures.
 */
export function ChartControls({
  macd,
  stoch,
  onMacd,
  onStoch,
  onZoomIn,
  onZoomOut,
  onReset,
  canReset,
  patterns,
}: {
  macd: boolean;
  stoch: boolean;
  onMacd: () => void;
  onStoch: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  canReset: boolean;
  /** omit on charts that do not draw price-action patterns */
  patterns?: PatternControl;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <HButton onClick={onMacd} aria-pressed={macd} style={pill(macd)} hoverStyle={{ background: macd ? '#e4edff' : '#f7f8f8' }}>
        MACD
      </HButton>
      <HButton onClick={onStoch} aria-pressed={stoch} style={pill(stoch)} hoverStyle={{ background: stoch ? '#e4edff' : '#f7f8f8' }}>
        Stoch RSI
      </HButton>
      {patterns && <PatternChooser {...patterns} />}
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 10.5, color: '#a2a8ae', whiteSpace: 'nowrap' }}>scroll = zoom · drag = pan · shift+drag = zoom range</span>
      <HButton onClick={onZoomOut} aria-label="Zoom out" style={icon(true)} hoverStyle={{ background: '#f7f8f8' }}>
        −
      </HButton>
      <HButton onClick={onZoomIn} aria-label="Zoom in" style={icon(true)} hoverStyle={{ background: '#f7f8f8' }}>
        +
      </HButton>
      <HButton
        onClick={onReset}
        disabled={!canReset}
        style={{ ...icon(canReset), minWidth: 0, padding: '5px 10px' }}
        hoverStyle={canReset ? { background: '#f7f8f8' } : undefined}
      >
        Reset view
      </HButton>
    </div>
  );
}
