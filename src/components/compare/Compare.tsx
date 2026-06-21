import { useEffect, useRef } from 'react';
import type { Stock } from '../../lib/market';
import { useScreener } from '../../store';
import { HButton } from '../ui/Hoverable';

// ----------------------------------------------------------------------------
// Faithful port of the POC compare UI (Stock Screener.dc.html 624–679):
//   CompareBar     — floating bottom bar with selected tickers + Compare button
//   CompareDrawer  — modal with per-ticker columns (mini candlestick + 6 stats)
// The per-ticker view-model mirrors `_compareCol` (1529–1549); the mini chart
// mirrors `_drawMini` (1612–1633) — last 70 sessions.
// ----------------------------------------------------------------------------

const col = (c: number) => (c >= 0 ? '#06a96b' : '#e23d3d');

export function CompareBar() {
  const compareSel = useScreener((s) => s.compareSel);
  const toggleCompare = useScreener((s) => s.toggleCompare);
  const openCompare = useScreener((s) => s.openCompare);
  const clearCompare = useScreener((s) => s.clearCompare);

  if (!compareSel.length) return null;
  const canCompare = compareSel.length >= 2;

  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 35, display: 'flex', alignItems: 'center', gap: 12, background: '#15171a', color: '#fff', padding: '9px 12px 9px 16px', borderRadius: 13, boxShadow: '0 12px 34px rgba(0,0,0,0.28)' }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8a9099' }}>Compare</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {compareSel.map((t) => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: '#2a2e33', padding: '4px 8px', borderRadius: 7 }}>
            {t}
            <button onClick={() => toggleCompare(t)} style={{ border: 'none', background: 'none', color: '#9aa1a8', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
          </span>
        ))}
      </div>
      {canCompare ? (
        <HButton onClick={openCompare} style={{ padding: '7px 14px', border: 'none', borderRadius: 8, background: '#06a96b', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#05935d' }}>Compare {compareSel.length}</HButton>
      ) : (
        <span style={{ fontSize: 12, color: '#6f757c' }}>Pick 2–4</span>
      )}
      <button onClick={clearCompare} style={{ border: 'none', background: 'none', color: '#9aa1a8', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
    </div>
  );
}

// mini candlestick chart — last 70 bars (POC `_drawMini`, 1612–1633)
function MiniChart({ stock }: { stock: Stock }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      if (!canvas.parentElement) return;
      const cssW = Math.max(120, canvas.parentElement.clientWidth), cssH = 124;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cssW * dpr; canvas.height = cssH * dpr;
      canvas.style.width = '100%'; canvas.style.height = cssH + 'px';
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const s = stock;
      const N = 70, o = s.full.o, h = s.full.h, l = s.full.l, c = s.full.c, L = c.length, start = Math.max(0, L - N);
      let hi = -Infinity, lo = Infinity;
      for (let i = start; i < L; i++) { if (h[i] > hi) hi = h[i]; if (l[i] < lo) lo = l[i]; }
      const pad = (hi - lo) * 0.06 || 1; hi += pad; lo -= pad;
      const n = L - start, plotW = cssW - 4;
      const x = (i: number) => 2 + (i + 0.5) * (plotW / n);
      const py = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (cssH - 8);
      const cw = Math.max(1, (plotW / n) * 0.6);
      for (let i = 0; i < n; i++) {
        const a = start + i, up = c[a] >= o[a], color = up ? '#06a96b' : '#e23d3d', cx = x(i);
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, py(h[a])); ctx.lineTo(cx, py(l[a])); ctx.stroke();
        ctx.fillStyle = color; const yo = py(o[a]), yc = py(c[a]); ctx.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo)));
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [stock]);

  return (
    <div style={{ position: 'relative', marginBottom: 14 }}>
      <canvas ref={ref} style={{ display: 'block', width: '100%' }} />
    </div>
  );
}

function CompareColumn({ stock }: { stock: Stock }) {
  const toggleCompare = useScreener((s) => s.toggleCompare);
  const s = stock;
  const tr: [string, string] = s.ema20 > s.ema50 && s.ema50 > s.ema200 ? ['Strong up', '#06a96b']
    : s.ema50 > s.ema200 ? ['Uptrend', '#06a96b']
      : s.ema20 < s.ema50 && s.ema50 < s.ema200 ? ['Downtrend', '#e23d3d'] : ['Mixed', '#6b7280'];
  const stats = [
    { label: 'RSI 14', value: s.rsi.toFixed(1), color: s.rsi > 70 ? '#e23d3d' : s.rsi < 30 ? '#06a96b' : '#15171a' },
    { label: 'MACD hist', value: s.macdHist.toFixed(3), color: col(s.macdHist) },
    { label: 'Stoch %K', value: s.stochK.toFixed(1), color: s.stochK > 80 ? '#e23d3d' : s.stochK < 20 ? '#06a96b' : '#15171a' },
    { label: 'Rel vol', value: s.relVol.toFixed(2) + '×', color: s.relVol > 1.5 ? '#06a96b' : '#15171a' },
    { label: 'Trend', value: tr[0], color: tr[1] },
    { label: '52w pos', value: s.pct52w.toFixed(0) + '%', color: '#15171a' },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0, background: '#fff', padding: '16px 16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{s.ticker}</div>
          <div style={{ fontSize: 11, color: '#9aa1a8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
        </div>
        <button onClick={() => toggleCompare(s.ticker)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c0c5ca', fontSize: 13 }}>✕</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 12px' }}>
        <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{'$' + s.price.toFixed(2)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: col(s.changePct) }}>{(s.changePct >= 0 ? '+' : '') + s.changePct.toFixed(2) + '%'}</span>
      </div>
      <MiniChart stock={s} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: '#f0f1f2', borderRadius: 8, overflow: 'hidden' }}>
        {stats.map((ss, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#fff', padding: '8px 11px' }}>
            <span style={{ fontSize: 11.5, color: '#8b9298' }}>{ss.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: ss.color }}>{ss.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompareDrawer() {
  const compareOpen = useScreener((s) => s.compareOpen);
  const compareSel = useScreener((s) => s.compareSel);
  const universe = useScreener((s) => s.universe);
  const closeCompare = useScreener((s) => s.closeCompare);

  if (!compareOpen || compareSel.length < 2) return null;
  const cols = compareSel.map((t) => universe.find((s) => s.ticker === t)).filter((s): s is Stock => !!s);

  return (
    <div onClick={closeCompare} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.32)', zIndex: 55, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1080px,96vw)', maxHeight: '92vh', overflowY: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)', animation: 'popin 0.18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #f0f1f2' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Compare</div>
            <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 2 }}>Side-by-side · last 70 sessions</div>
          </div>
          <button onClick={closeCompare} style={{ width: 34, height: 34, border: '1px solid #ececef', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#6b7280' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 1, background: '#ececef' }}>
          {cols.map((s) => <CompareColumn key={s.ticker} stock={s} />)}
        </div>
      </div>
    </div>
  );
}
