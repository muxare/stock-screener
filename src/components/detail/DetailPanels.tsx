import { useMemo } from 'react';
import type { Rule } from '../../lib/market';
import { useScreener } from '../../store';
import { StockDetail } from './StockDetail';

// ----------------------------------------------------------------------------
// Faithful port of the POC's detail mounting (Stock Screener.dc.html 398–422).
// DetailDock renders the docked 660px right column; DetailOverlay renders the
// fixed full-screen scrim + sliding right panel. Both read the store and feed
// <StockDetail>. detailRules() returns a fresh array, so we recompute it via
// useMemo keyed on its inputs (read through selectors to avoid the
// getSnapshot warning zustand emits for new references).
// ----------------------------------------------------------------------------

function useDetailRules(): Rule[] {
  const rankTickers = useScreener((s) => s.rankTickers);
  const activePreset = useScreener((s) => s.activePreset);
  const customRules = useScreener((s) => s.customRules);
  const selected = useScreener((s) => s.selected);
  return useMemo(
    () => useScreener.getState().detailRules(),
    [rankTickers, activePreset, customRules, selected],
  );
}

export function DetailDock() {
  const selected = useScreener((s) => s.selected);
  const displayed = useScreener((s) => s.displayed);
  const panels = useScreener((s) => s.panels);
  const closeDetail = useScreener((s) => s.closeDetail);
  const togglePanel = useScreener((s) => s.togglePanel);
  const ruleLabel = useScreener((s) => s.ruleLabel);
  const rules = useDetailRules();
  const selectedStock = (selected && displayed[selected]) || null;

  return (
    <div style={{ width: 660, flex: 'none', borderLeft: '1px solid #e7e8ea', background: '#fff', minHeight: 0 }}>
      {selectedStock ? (
        <StockDetail
          stock={selectedStock}
          panels={panels}
          rules={rules}
          onClose={closeDetail}
          onTogglePanel={togglePanel}
          ruleLabel={ruleLabel}
        />
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#b8bec4', padding: 40, textAlign: 'center' }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: '#f4f5f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>▦</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#8b9298' }}>Select a stock</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>Click any row to load its candlestick chart with your screening overlays applied.</div>
        </div>
      )}
    </div>
  );
}

export function DetailOverlay() {
  const layout = useScreener((s) => s.layout);
  const selected = useScreener((s) => s.selected);
  const displayed = useScreener((s) => s.displayed);
  const panels = useScreener((s) => s.panels);
  const closeDetail = useScreener((s) => s.closeDetail);
  const togglePanel = useScreener((s) => s.togglePanel);
  const ruleLabel = useScreener((s) => s.ruleLabel);
  const rules = useDetailRules();
  const selectedStock = (selected && displayed[selected]) || null;

  if (layout !== 'overlay' || !selectedStock) return null;

  return (
    <div onClick={closeDetail} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.32)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1080px,94vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 40px rgba(0,0,0,0.16)', animation: 'slidein 0.22s ease' }}>
        <StockDetail
          stock={selectedStock}
          panels={panels}
          rules={rules}
          onClose={closeDetail}
          onTogglePanel={togglePanel}
          ruleLabel={ruleLabel}
        />
      </div>
    </div>
  );
}
