import { useEffect, useMemo, useRef } from 'react';
import type { FanBacktestConfig } from '../../lib/fanBacktest';
import { buildFanExample } from '../../lib/fanExample';

const PRICE_H = 248;
const VOL_H = 36;
const MACD_H = 48;
const PAD_T = 36;
const PAD_B = 10;
const E18 = '#06a96b';
const E50 = '#3aa0ff';
const E100 = '#d9871f';
const E200 = '#9b51e0';
const UP = '#06a96b';
const DN = '#e23d3d';

export function FanExampleChart({ config }: { config: FanBacktestConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const example = useMemo(() => buildFanExample(config), [config]);
  const cssH = PAD_T + PRICE_H + 8 + VOL_H + (example.showMacd ? 8 + MACD_H : 0) + PAD_B;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ex = example;

    const draw = () => {
      const wrap = cv.parentElement;
      if (!wrap) return;
      const cssW = Math.max(280, wrap.clientWidth);
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.floor(cssW * dpr);
      cv.height = Math.floor(cssH * dpr);
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const bars = ex.bars;
      const N = bars.length;
      if (N < 2) return;
      const padL = 6, padR = 52, plotW = cssW - padL - padR;
      const x = (i: number) => padL + (i + 0.5) * (plotW / N);
      const cw = Math.max(2.2, (plotW / N) * 0.62);

      let hi = -Infinity, lo = Infinity;
      for (let i = 0; i < N; i++) {
        hi = Math.max(hi, bars[i].h, ex.ema18[i], ex.ema50[i], ex.ema100[i], ex.ema200[i]);
        lo = Math.min(lo, bars[i].l, ex.ema18[i], ex.ema50[i], ex.ema100[i], ex.ema200[i]);
      }
      for (const lv of ex.levels) {
        hi = Math.max(hi, lv.price);
        lo = Math.min(lo, lv.price);
      }
      for (const b of ex.bands) {
        hi = Math.max(hi, b.hi);
        lo = Math.min(lo, b.lo);
      }
      const pad = (hi - lo) * 0.08 || 1;
      hi += pad; lo -= pad;
      const py = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * PRICE_H;
      const volTop = PAD_T + PRICE_H + 8;

      for (const p of ex.phases) {
        const x0 = x(p.from) - cw / 2;
        const x1 = x(p.to) + cw / 2;
        ctx.fillStyle = p.fill;
        ctx.fillRect(x0, PAD_T, Math.max(4, x1 - x0), PRICE_H);
      }

      for (const b of ex.bands) {
        ctx.fillStyle = b.fill;
        ctx.fillRect(padL, py(b.hi), plotW, Math.max(4, py(b.lo) - py(b.hi)));
        ctx.fillStyle = '#d9871f';
        ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(b.label, padL + 4, py(b.hi) - 2);
      }

      ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#eef0f1';
      ctx.fillStyle = '#9aa1a8';
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      for (let g = 0; g <= 3; g++) {
        const val = lo + (hi - lo) * (g / 3);
        const yy = py(val);
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText(val.toFixed(1), padL + plotW + 6, yy);
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = "9px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      for (const p of ex.phases) {
        if (p.to - p.from < 1 && p.id !== 'tag' && p.id !== 'bounce') continue;
        const cx = (x(p.from) + x(p.to)) / 2;
        ctx.fillStyle = '#5b6168';
        const label = p.label.length > 18 ? p.label.slice(0, 16) + '…' : p.label;
        ctx.fillText(label, cx, PAD_T + 4);
      }

      let vmax = 1;
      for (const b of bars) if (b.v > vmax) vmax = b.v;
      for (let i = 0; i < N; i++) {
        const b = bars[i];
        const up = b.c >= b.o;
        const color = up ? UP : DN;
        const cx = x(i);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, py(b.h)); ctx.lineTo(cx, py(b.l)); ctx.stroke();
        const yo = py(b.o), yc = py(b.c);
        ctx.fillStyle = color;
        ctx.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1.4, Math.abs(yc - yo)));
        const hh = (b.v / vmax) * (VOL_H - 4);
        ctx.fillStyle = up ? 'rgba(6,169,107,0.4)' : 'rgba(226,61,61,0.35)';
        ctx.fillRect(cx - cw / 2, volTop + VOL_H - hh, cw, hh);
      }

      const line = (arr: number[], color: string, width = 1.7) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          if (i === 0) ctx.moveTo(x(i), py(arr[i]));
          else ctx.lineTo(x(i), py(arr[i]));
        }
        ctx.stroke();
      };
      line(ex.ema18, E18);
      line(ex.ema50, E50, 2.1);
      line(ex.ema100, E100);
      line(ex.ema200, E200);

      for (const lv of ex.levels) {
        const yy = py(lv.price);
        ctx.strokeStyle = lv.color;
        ctx.lineWidth = 1;
        ctx.setLineDash(lv.dash);
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = lv.color;
        ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(lv.label, padL + 4, yy - 2);
      }

      for (const m of ex.marks) {
        if (m.bar < 0 || m.bar >= N) continue;
        const cx = x(m.bar), cy = py(m.price);
        ctx.fillStyle = m.kind === 'exit' ? DN : m.kind === 'entry' ? UP : m.kind === 'adverse' ? DN : '#c47a14';
        if (m.kind === 'entry') {
          ctx.beginPath();
          ctx.moveTo(cx, cy - 8);
          ctx.lineTo(cx - 5, cy + 3);
          ctx.lineTo(cx + 5, cy + 3);
          ctx.closePath();
          ctx.fill();
        } else if (m.kind === 'exit') {
          ctx.fillRect(cx - 3.5, cy - 3.5, 7, 7);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
        } else if (m.kind === 'impulse') {
          ctx.beginPath();
          ctx.moveTo(cx, cy + 7);
          ctx.lineTo(cx - 4, cy - 2);
          ctx.lineTo(cx + 4, cy - 2);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(cx, cy - 4);
          ctx.lineTo(cx + 4, cy);
          ctx.lineTo(cx, cy + 4);
          ctx.lineTo(cx - 4, cy);
          ctx.closePath();
          ctx.fill();
        }
        ctx.font = "9px 'Helvetica Neue', Helvetica, Arial, sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(m.label, cx + 6, cy - 2);
      }

      ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let lx = padL + 2;
      ctx.fillStyle = '#6b7280';
      ctx.fillText('Schematic', lx, 6);
      lx += ctx.measureText('Schematic   ').width;
      for (const [lab, col] of [['18', E18], ['50', E50], ['100', E100], ['200', E200]] as const) {
        ctx.fillStyle = col;
        ctx.fillText(lab, lx, 6);
        lx += ctx.measureText(lab + '  ').width;
      }
      ctx.fillStyle = '#9aa1a8';
      ctx.fillText('Vol', padL + 4, volTop + 2);

      if (!ex.showMacd) return;
      const macdTop = volTop + VOL_H + 8;
      let mLo = 0, mHi = 0;
      for (let i = 0; i < N; i++) {
        for (const v of [ex.macd.line[i], ex.macd.signal[i], ex.macd.hist[i]]) {
          if (!Number.isFinite(v)) continue;
          mLo = Math.min(mLo, v);
          mHi = Math.max(mHi, v);
        }
      }
      if (!(mHi > mLo)) { mLo = -1; mHi = 1; }
      const mPad = (mHi - mLo) * 0.1;
      mLo -= mPad; mHi += mPad;
      const my = (v: number) => macdTop + (1 - (v - mLo) / (mHi - mLo)) * MACD_H;
      ctx.fillStyle = '#f7f8f8';
      ctx.fillRect(padL, macdTop, plotW, MACD_H);
      const zeroY = my(0);
      ctx.strokeStyle = '#e7e8ea';
      ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(padL + plotW, zeroY); ctx.stroke();
      for (let i = 0; i < N; i++) {
        const hv = ex.macd.hist[i];
        if (!Number.isFinite(hv)) continue;
        const hy = my(hv);
        ctx.fillStyle = hv >= 0 ? 'rgba(6,169,107,0.45)' : 'rgba(226,61,61,0.4)';
        ctx.fillRect(x(i) - cw / 2, Math.min(zeroY, hy), cw, Math.max(1, Math.abs(hy - zeroY)));
      }
      ctx.strokeStyle = '#3aa0ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i === 0) ctx.moveTo(x(i), my(ex.macd.line[i]));
        else ctx.lineTo(x(i), my(ex.macd.line[i]));
      }
      ctx.stroke();
      ctx.strokeStyle = '#d9871f';
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (i === 0) ctx.moveTo(x(i), my(ex.macd.signal[i]));
        else ctx.lineTo(x(i), my(ex.macd.signal[i]));
      }
      ctx.stroke();
      ctx.fillStyle = '#9aa1a8';
      ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('18–50 MACD window', padL + 4, macdTop + 3);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv.parentElement!);
    return () => ro.disconnect();
  }, [example, cssH]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, height: '100%' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2328' }}>{example.title}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, lineHeight: 1.45 }}>{example.caption}</div>
      </div>
      <div style={{ position: 'relative', minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${example.title} candlestick schematic`}
          style={{ display: 'block' }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {example.phases.map((p) => (
          <span
            key={`${p.id}-${p.from}`}
            style={{
              fontSize: 10.5, fontWeight: 650, color: '#3b4046',
              background: p.fill, border: '1px solid #eef0f1',
              borderRadius: 999, padding: '3px 8px',
            }}
          >
            {p.label}
          </span>
        ))}
      </div>
      <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: '#5b6168', lineHeight: 1.5 }}>
        {example.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
