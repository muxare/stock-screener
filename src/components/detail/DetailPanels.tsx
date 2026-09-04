import { useScreener } from '../../store';
import { FanDetail } from './FanDetail';

const spinner = <div style={{ width: 26, height: 26, border: '3px solid #ececef', borderTopColor: '#9aa1a8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />;

function DetailFallback({ ticker, status }: { ticker: string; status: 'loading' | 'error' }) {
  const retryDisplayed = useScreener((s) => s.retryDisplayed);
  if (status === 'error') {
    return (
      <div role="alert" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, textAlign: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b3641a' }}>Couldn't load</span>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#8a6321' }}>{ticker} failed to load</div>
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

export function DetailOverlay() {
  const selected = useScreener((s) => s.selected);
  const displayed = useScreener((s) => s.displayed);
  const status = useScreener((s) => (selected ? s.displayStatus[selected] : undefined));
  const closeDetail = useScreener((s) => s.closeDetail);
  const selectedStock = (selected && displayed[selected]) || null;
  if (!selected) return null;

  return (
    <div onClick={closeDetail} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.32)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1080px,94vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 40px rgba(0,0,0,0.16)', animation: 'slidein 0.22s ease', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedStock ? (
          <FanDetail stock={selectedStock} onClose={closeDetail} />
        ) : (
          <DetailFallback ticker={selected} status={status === 'error' ? 'error' : 'loading'} />
        )}
      </div>
    </div>
  );
}
