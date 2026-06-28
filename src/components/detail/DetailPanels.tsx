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

const spinner = <div style={{ width: 26, height: 26, border: '3px solid #ececef', borderTopColor: '#9aa1a8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />;

// Shown when a name is selected but its on-demand `/instrument` fetch is still
// in flight or failed (STORY-026): the panel must never read as a blank/absent
// detail. 'error' offers a retry that re-requests the bars (AC4).
function DetailFallback({ ticker, status }: { ticker: string; status: 'loading' | 'error' }) {
  const retryDisplayed = useScreener((s) => s.retryDisplayed);
  if (status === 'error') {
    return (
      <div role="alert" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, textAlign: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b3641a' }}>Couldn't load</span>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#8a6321' }}>{ticker} failed to load</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#a98a52', maxWidth: 280 }}>The data request for this name didn't complete. Check the service and try again.</div>
        <button onClick={() => retryDisplayed(ticker)} style={{ marginTop: 4, padding: '7px 16px', border: '1px solid #d9a85a', borderRadius: 8, background: '#fff', color: '#8a6321', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#9aa1a8', padding: 40, textAlign: 'center' }}>
      {spinner}
      <div style={{ fontSize: 13, fontWeight: 600 }}>Loading {ticker}…</div>
    </div>
  );
}

export function DetailDock() {
  const selected = useScreener((s) => s.selected);
  const displayed = useScreener((s) => s.displayed);
  // Subscribe to only the selected name's status, not the whole map, so an
  // unrelated name's fetch resolving doesn't re-render the panel (STORY-026).
  const status = useScreener((s) => (selected ? s.displayStatus[selected] : undefined));
  const panels = useScreener((s) => s.panels);
  const closeDetail = useScreener((s) => s.closeDetail);
  const togglePanel = useScreener((s) => s.togglePanel);
  const ruleLabel = useScreener((s) => s.ruleLabel);
  const rules = useDetailRules();
  const selectedStock = (selected && displayed[selected]) || null;
  // A selected name with no built Stock yet is loading or failed, not "nothing
  // selected" — show its fetch state, not the empty placeholder.

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
      ) : selected ? (
        <DetailFallback ticker={selected} status={status === 'error' ? 'error' : 'loading'} />
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
  // Subscribe to only the selected name's status (STORY-026) — see DetailDock.
  const status = useScreener((s) => (selected ? s.displayStatus[selected] : undefined));
  const panels = useScreener((s) => s.panels);
  const closeDetail = useScreener((s) => s.closeDetail);
  const togglePanel = useScreener((s) => s.togglePanel);
  const ruleLabel = useScreener((s) => s.ruleLabel);
  const rules = useDetailRules();
  const selectedStock = (selected && displayed[selected]) || null;

  // Open whenever a name is selected — gating on the built Stock would make a
  // slow/failed fetch render as no overlay at all (STORY-026, finding 7).
  if (layout !== 'overlay' || !selected) return null;

  return (
    <div onClick={closeDetail} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.32)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1080px,94vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 40px rgba(0,0,0,0.16)', animation: 'slidein 0.22s ease' }}>
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
          <DetailFallback ticker={selected} status={status === 'error' ? 'error' : 'loading'} />
        )}
      </div>
    </div>
  );
}
