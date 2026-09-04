import type { CSSProperties } from 'react';
import { HButton } from './Hoverable';

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
 * Control strip shared by the candlestick charts: MACD / Stoch RSI toggles on
 * the left, zoom + reset controls on the right, with a hint about the
 * scroll-to-zoom / drag-to-pan gestures.
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
}: {
  macd: boolean;
  stoch: boolean;
  onMacd: () => void;
  onStoch: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  canReset: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <HButton onClick={onMacd} aria-pressed={macd} style={pill(macd)} hoverStyle={{ background: macd ? '#e4edff' : '#f7f8f8' }}>
        MACD
      </HButton>
      <HButton onClick={onStoch} aria-pressed={stoch} style={pill(stoch)} hoverStyle={{ background: stoch ? '#e4edff' : '#f7f8f8' }}>
        Stoch RSI
      </HButton>
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
