import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useScreener } from '../../store';
import { FanDetail } from './FanDetail';
import { clampDockWidth, isNarrow } from '../../lib/screen/dock';
import { HDiv } from '../ui/Hoverable';

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

const DEFAULT_VIEWPORT = 1440;

/** Re-renders the dock when the viewport crosses the docked / overlay line. */
function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? DEFAULT_VIEWPORT : window.innerWidth));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/**
 * The dock's left edge. The chart canvas redraws through its ResizeObserver on
 * every width change, so pointer moves are coalesced to one width per frame.
 */
function DragHandle({ width, onResize }: { width: number; onResize: (px: number) => void }) {
  const [dragging, setDragging] = useState(false);

  // Mouse rather than pointer events: preventDefault on mousedown is what
  // actually stops the drag from selecting the table text behind it.
  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const restoreSelect = document.body.style.userSelect;
    let frame = 0;
    let pending = startW;
    document.body.style.userSelect = 'none';
    setDragging(true);

    const move = (ev: MouseEvent) => {
      pending = clampDockWidth(startW + (startX - ev.clientX), window.innerWidth);
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; onResize(pending); });
    };
    const up = () => {
      document.body.style.userSelect = restoreSelect;
      setDragging(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <HDiv
      data-help="detail-dock"
      onMouseDown={onMouseDown}
      title="Drag to resize the chart panel"
      style={{
        flex: 'none', width: 8, cursor: 'col-resize',
        borderLeft: `1px solid ${dragging ? '#06a96b' : '#e7e8ea'}`,
        background: dragging ? '#eafaf3' : '#f4f5f6',
      }}
      hoverStyle={{ borderLeft: '1px solid #06a96b', background: '#eafaf3' }}
    />
  );
}

/**
 * DetailDock — the candlestick chart beside the list rather than over it.
 *
 * Wide enough, it is a resizable flex sibling of the table: the list stays
 * visible and clicking another row swaps the symbol in place. Under
 * `DOCK_BREAKPOINT` there is no room for both, so it falls back to the
 * full-height overlay with its click-outside backdrop. Esc closes either.
 */
export function DetailDock() {
  const selected = useScreener((s) => s.selected);
  const displayed = useScreener((s) => s.displayed);
  const status = useScreener((s) => (selected ? s.displayStatus[selected] : undefined));
  const closeDetail = useScreener((s) => s.closeDetail);
  const dockWidth = useScreener((s) => s.dockWidth);
  const setDockWidth = useScreener((s) => s.setDockWidth);
  const viewportW = useViewportWidth();

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      // The help layer owns Escape while one of its cards is up.
      if (e.key !== 'Escape' || document.querySelector('[data-help-card]')) return;
      closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, closeDetail]);

  const selectedStock = (selected && displayed[selected]) || null;
  if (!selected) return null;

  const body = selectedStock
    ? <FanDetail stock={selectedStock} onClose={closeDetail} />
    : <DetailFallback ticker={selected} status={status === 'error' ? 'error' : 'loading'} />;

  if (isNarrow(viewportW)) {
    return (
      <div onClick={closeDetail} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.32)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1080px,94vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 40px rgba(0,0,0,0.16)', animation: 'slidein 0.22s ease', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {body}
        </div>
      </div>
    );
  }

  const width = clampDockWidth(dockWidth, viewportW);
  return (
    <div style={{ flex: 'none', width, display: 'flex', minWidth: 0, background: '#fff' }}>
      <DragHandle width={width} onResize={setDockWidth} />
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>{body}</div>
    </div>
  );
}
