import { useEffect, useMemo, useRef, useState } from 'react';
import type { Stock } from '../../lib/market';
import { ema, macd, rsi, stochRsi } from '../../lib/indicators';
import { classifyCloses } from '../../lib/fan';
import { useChartViewport } from '../../lib/chart/viewport';
import { barIndexAtX, drawZoomSelection, isInPlot, type ZoomSelection } from '../../lib/chart/interactions';
import { drawMacdPane, drawStochPane } from '../../lib/chart/panes';
import { HButton } from '../ui/Hoverable';
import { ChartControls } from '../ui/ChartControls';
import { Disclosure } from '../ui/Disclosure';

const EMA_COLORS: { key: 'ema18' | 'ema50' | 'ema100' | 'ema200'; period: number; color: string; label: string }[] = [
  { key: 'ema18', period: 18, color: '#06a96b', label: 'EMA 18' },
  { key: 'ema50', period: 50, color: '#3aa0ff', label: 'EMA 50' },
  { key: 'ema100', period: 100, color: '#d9871f', label: 'EMA 100' },
  { key: 'ema200', period: 200, color: '#9b51e0', label: 'EMA 200' },
];

const PRICE_H = 320;
const VOL_H = 78;
const MACD_H = 72;
const STOCH_H = 72;
const GAP = 16;
const PAD_T = 8;
const PAD_B = 24;
const PAD_L = 8;
const PAD_R = 58;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const col = (c: number) => (c >= 0 ? '#06a96b' : '#e23d3d');
const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const gapPct = (g: number) => (Number.isFinite(g) ? (g * 100).toFixed(2) + '%' : '—');

function parseDate(iso: string | undefined, i: number, n: number): Date {
  if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) return new Date(iso + 'T00:00:00');
  const d = new Date();
  d.setDate(d.getDate() - (n - 1 - i));
  return d;
}

export function FanDetail({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef({ padL: PAD_L, plotW: 1, visible: 1, from: 0, to: 0, bottom: 0 });
  const dragRef = useRef({ active: false, lastX: 0, acc: 0 });
  const selectionRef = useRef<ZoomSelection>({ active: false, startBar: 0, endBar: 0 });

  const [macdOn, setMacdOn] = useState(true);
  const [stochOn, setStochOn] = useState(true);

  const cls = classifyCloses(stock.full.c);
  const emas = Number.isFinite(cls.emas.ema18) ? cls.emas : null;
  const nBars = stock.full.c.length;

  const series = useMemo(() => {
    const c = stock.full.c;
    return {
      ema18: ema(c, 18),
      ema50: ema(c, 50),
      ema100: ema(c, 100),
      ema200: ema(c, 200),
      macd: macd(c),
      stoch: stochRsi(rsi(c, 14), 14, 3, 3),
    };
  }, [stock]);

  const { view, zoomAtBar, panByBars, setRange, reset, isDefault } = useChartViewport(
    nBars,
    { from: 0, to: Math.max(0, nBars - 1) },
  );

  const chartH = PAD_T + PRICE_H + GAP + VOL_H
    + (macdOn ? GAP + MACD_H : 0)
    + (stochOn ? GAP + STOCH_H : 0)
    + PAD_B;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || nBars < 2) return;

    const emaSeries = {
      ema18: series.ema18, ema50: series.ema50, ema100: series.ema100, ema200: series.ema200,
    } as const;

    const draw = () => {
      const wrap = cv.parentElement;
      if (!wrap) return;
      const cssW = Math.max(320, wrap.clientWidth);
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.floor(cssW * dpr);
      cv.height = Math.floor(chartH * dpr);
      cv.style.width = cssW + 'px';
      cv.style.height = chartH + 'px';
      const ov = overlayRef.current;
      if (ov) {
        ov.width = cv.width;
        ov.height = cv.height;
        ov.style.width = cssW + 'px';
        ov.style.height = chartH + 'px';
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, chartH);

      const o = stock.full.o, h = stock.full.h, l = stock.full.l, c = stock.full.c;
      const vol = stock.full.v ?? [];
      const dates = (stock.full.d ?? []).map((iso, i) => parseDate(iso, i, nBars));

      const from = view.from, to = view.to;
      const visible = to - from + 1;
      const padL = PAD_L, padR = PAD_R, plotW = cssW - padL - padR;
      const x = (i: number) => padL + (i - from + 0.5) * (plotW / visible);
      const cw = Math.max(1.5, (plotW / visible) * 0.62);
      const UP = '#06a96b', DN = '#e23d3d', GRID = '#eef0f1', TXT = '#9aa1a8';

      let hi = -Infinity, lo = Infinity;
      for (let i = from; i <= to; i++) {
        if (h[i] > hi) hi = h[i];
        if (l[i] < lo) lo = l[i];
        for (const e of EMA_COLORS) {
          const v = emaSeries[e.key][i];
          if (Number.isFinite(v)) { if (v > hi) hi = v; if (v < lo) lo = v; }
        }
      }
      const pad = (hi - lo) * 0.06 || 1;
      hi += pad; lo -= pad;

      const priceTop = PAD_T;
      const volTop = priceTop + PRICE_H + GAP;
      let cursorY = volTop + VOL_H + GAP;
      let macdTop = -1, stochTop = -1;
      if (macdOn) { macdTop = cursorY; cursorY += MACD_H + GAP; }
      if (stochOn) { stochTop = cursorY; cursorY += STOCH_H + GAP; }
      const bottom = cursorY - GAP;
      const axisY = bottom + 6;

      const py = (v: number) => priceTop + (1 - (v - lo) / (hi - lo)) * PRICE_H;

      layoutRef.current = { padL, plotW, visible, from, to, bottom };

      ctx.font = "11px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = GRID;
      ctx.fillStyle = TXT;
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      for (let g = 0; g <= 4; g++) {
        const val = lo + (hi - lo) * (g / 4);
        const yy = py(val);
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText(val.toFixed(val < 50 ? 2 : 1), padL + plotW + 6, yy);
      }

      if (dates.length === nBars) {
        ctx.strokeStyle = '#f4f5f6';
        for (let i = Math.max(1, from); i <= to; i++) {
          if (dates[i].getMonth() !== dates[i - 1].getMonth()) {
            ctx.beginPath(); ctx.moveTo(x(i), priceTop); ctx.lineTo(x(i), priceTop + PRICE_H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x(i), volTop); ctx.lineTo(x(i), volTop + VOL_H); ctx.stroke();
          }
        }
      }

      for (let i = from; i <= to; i++) {
        const up = c[i] >= o[i], color = up ? UP : DN, cx = x(i);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, py(h[i])); ctx.lineTo(cx, py(l[i])); ctx.stroke();
        const yo = py(o[i]), yc = py(c[i]);
        ctx.fillStyle = color;
        ctx.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1.2, Math.abs(yc - yo)));
      }

      for (const e of EMA_COLORS) {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let started = false;
        for (let i = from; i <= to; i++) {
          const v = emaSeries[e.key][i];
          if (!Number.isFinite(v)) continue;
          if (!started) { ctx.moveTo(x(i), py(v)); started = true; }
          else ctx.lineTo(x(i), py(v));
        }
        ctx.stroke();
      }

      ctx.textAlign = 'left';
      let lx = padL + 4;
      for (const e of EMA_COLORS) {
        ctx.fillStyle = e.color;
        ctx.fillRect(lx, priceTop + 6, 12, 3);
        ctx.fillStyle = '#6b7280';
        ctx.fillText(e.label, lx + 16, priceTop + 8);
        lx += ctx.measureText(e.label).width + 34;
      }

      let vmax = 0;
      for (let i = from; i <= to; i++) if ((vol[i] || 0) > vmax) vmax = vol[i];
      vmax = vmax || 1;
      for (let i = from; i <= to; i++) {
        const up = c[i] >= o[i];
        const hh = ((vol[i] || 0) / vmax) * (VOL_H - 4);
        ctx.fillStyle = up ? 'rgba(6,169,107,0.45)' : 'rgba(226,61,61,0.4)';
        ctx.fillRect(x(i) - cw / 2, volTop + VOL_H - hh, cw, hh);
      }
      ctx.fillStyle = TXT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Volume', padL + 4, volTop + 9);

      if (macdOn) {
        drawMacdPane({ ctx, macd: series.macd, from, to, x, top: macdTop, height: MACD_H, plotLeft: padL, plotW, cw });
      }
      if (stochOn) {
        drawStochPane({ ctx, stoch: series.stoch, from, to, x, top: stochTop, height: STOCH_H, plotLeft: padL, plotW });
      }

      ctx.fillStyle = TXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (dates.length === nBars) {
        let lastM = -1;
        for (let i = from; i <= to; i++) {
          const m = dates[i].getMonth();
          if (m === lastM) continue;
          lastM = m;
          ctx.fillText(MON[m], x(i), axisY);
        }
      }
    };

    const hideCrosshair = () => {
      const ov = overlayRef.current;
      const g = ov?.getContext('2d');
      if (ov && g) {
        const dpr = window.devicePixelRatio || 1;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, ov.width, ov.height);
      }
      if (readoutRef.current) readoutRef.current.style.display = 'none';
    };

    const drawCrosshair = (mx: number, my: number) => {
      const cvEl = canvasRef.current, ov = overlayRef.current, readout = readoutRef.current;
      if (!cvEl || !ov || !readout) return;
      const { padL, plotW, visible, from, to, bottom } = layoutRef.current;
      if (mx < padL || mx > padL + plotW || my < PAD_T || my > bottom) {
        hideCrosshair();
        return;
      }
      const i = Math.max(from, Math.min(to, from + Math.round((mx - padL) / (plotW / visible) - 0.5)));
      const snapX = padL + (i - from + 0.5) * (plotW / visible);
      const dpr = window.devicePixelRatio || 1;
      const ctx = ov.getContext('2d');
      if (!ctx) return;
      const cssW = cvEl.getBoundingClientRect().width;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, chartH);
      ctx.strokeStyle = 'rgba(21,23,26,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(snapX, PAD_T); ctx.lineTo(snapX, bottom); ctx.stroke();
      ctx.setLineDash([]);
      const bar = stock.full;
      const iso = bar.d?.[i] ?? '';
      readout.style.display = 'block';
      readout.textContent = `${iso}  O ${fmt(bar.o[i])}  H ${fmt(bar.h[i])}  L ${fmt(bar.l[i])}  C ${fmt(bar.c[i])}`;
    };

    const drawSelection = (mx: number, my: number) => {
      const ov = overlayRef.current, cvEl = canvasRef.current;
      if (!ov || !cvEl) return;
      const layout = layoutRef.current;
      if (!selectionRef.current.active || !isInPlot(mx, my, layout, PAD_T)) {
        hideCrosshair();
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const ctx = ov.getContext('2d');
      if (!ctx) return;
      const cssW = cvEl.getBoundingClientRect().width;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, chartH);
      drawZoomSelection(ctx, layout, selectionRef.current.startBar, selectionRef.current.endBar, PAD_T);
    };

    const onMove = (e: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (selectionRef.current.active) {
        selectionRef.current.endBar = barIndexAtX(mx, layoutRef.current);
        drawSelection(mx, my);
        return;
      }
      if (dragRef.current.active) {
        const { plotW, visible } = layoutRef.current;
        const barsPerPx = visible / Math.max(1, plotW);
        const dx = mx - dragRef.current.lastX;
        dragRef.current.lastX = mx;
        dragRef.current.acc += -dx * barsPerPx;
        const whole = Math.trunc(dragRef.current.acc);
        if (whole !== 0) { panByBars(whole); dragRef.current.acc -= whole; }
        return;
      }
      drawCrosshair(mx, my);
    };

    const onDown = (e: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const layout = layoutRef.current;
      if (e.shiftKey && isInPlot(mx, my, layout, PAD_T)) {
        const bar = barIndexAtX(mx, layout);
        selectionRef.current = { active: true, startBar: bar, endBar: bar };
        hideCrosshair();
        cv.style.cursor = 'crosshair';
        drawSelection(mx, my);
        return;
      }
      dragRef.current = { active: true, lastX: mx, acc: 0 };
      cv.style.cursor = 'grabbing';
      hideCrosshair();
    };

    const endPointer = () => {
      if (selectionRef.current.active) {
        const { startBar, endBar } = selectionRef.current;
        selectionRef.current.active = false;
        hideCrosshair();
        cv.style.cursor = 'grab';
        if (startBar !== endBar) {
          setRange(Math.min(startBar, endBar), Math.max(startBar, endBar));
        }
        return;
      }
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      cv.style.cursor = 'grab';
    };

    const onLeave = () => { hideCrosshair(); };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const { padL, plotW, visible, from } = layoutRef.current;
      const frac = Math.max(0, Math.min(1, (mx - padL) / Math.max(1, plotW)));
      const pivot = from + frac * (visible - 1);
      zoomAtBar(pivot, e.deltaY > 0 ? 1.15 : 1 / 1.15);
    };

    cv.style.cursor = 'grab';
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv.parentElement!);
    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mousedown', onDown);
    cv.addEventListener('mouseleave', onLeave);
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mouseup', endPointer);
    return () => {
      ro.disconnect();
      cv.removeEventListener('mousemove', onMove);
      cv.removeEventListener('mousedown', onDown);
      cv.removeEventListener('mouseleave', onLeave);
      cv.removeEventListener('wheel', onWheel);
      window.removeEventListener('mouseup', endPointer);
    };
  }, [stock, series, view.from, view.to, macdOn, stochOn, chartH, nBars, panByBars, zoomAtBar, setRange]);

  const center = (view.from + view.to) / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', borderBottom: '1px solid #ececef', flex: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{stock.ticker}</span>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{stock.name}</span>
          </div>
          <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stock.sector}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>${fmt(stock.price)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: col(stock.changePct) }}>
            {(stock.changePct >= 0 ? '+' : '') + fmt(stock.changePct)}%
          </span>
        </div>
        <HButton
          onClick={onClose}
          style={{ marginLeft: 8, width: 34, height: 34, border: '1px solid #ececef', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          hoverStyle={{ background: '#f5f6f7' }}
        >
          ✕
        </HButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: '#ececef', borderBottom: '1px solid #ececef', flex: 'none' }}>
        {([
          ['EMA 18', emas?.ema18, '#06a96b'],
          ['EMA 50', emas?.ema50, '#3aa0ff'],
          ['EMA 100', emas?.ema100, '#d9871f'],
          ['EMA 200', emas?.ema200, '#9b51e0'],
          ['Worst gap', cls?.worstGap, '#98a0a8'],
        ] as const).map(([label, value, color]) => (
          <div key={label} style={{ background: '#fff', padding: '11px 14px' }}>
            <div style={{ fontSize: 10, color: color, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>
              {label === 'Worst gap' ? gapPct(value as number) : fmt(value as number)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {nBars < 2 ? (
          <div style={{ padding: 40, color: '#8b9298', fontSize: 13, textAlign: 'center' }}>
            Not enough bars to draw a candlestick chart ({nBars} bar{nBars === 1 ? '' : 's'}).
          </div>
        ) : (
          <>
            <div style={{ padding: '12px 14px 0 14px' }}>
              <ChartControls
                macd={macdOn}
                stoch={stochOn}
                onMacd={() => setMacdOn((v) => !v)}
                onStoch={() => setStochOn((v) => !v)}
                onZoomIn={() => zoomAtBar(center, 1 / 1.3)}
                onZoomOut={() => zoomAtBar(center, 1.3)}
                onReset={reset}
                canReset={!isDefault}
              />
            </div>
            <div style={{ position: 'relative', padding: '10px 14px 0 14px' }}>
              <canvas ref={canvasRef} role="img" aria-label={`${stock.ticker} candlestick chart`} style={{ display: 'block' }} />
              <canvas ref={overlayRef} style={{ display: 'block', position: 'absolute', left: 14, top: 10, pointerEvents: 'none' }} />
              <div
                ref={readoutRef}
                style={{
                  position: 'absolute', left: 20, top: 16, display: 'none', pointerEvents: 'none',
                  background: 'rgba(255,255,255,0.92)', border: '1px solid #ececef', borderRadius: 7,
                  padding: '6px 9px', fontSize: 11, lineHeight: 1.5, zIndex: 2,
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            </div>
          </>
        )}
        <Disclosure style={{ padding: '16px 22px 22px' }} />
      </div>
    </div>
  );
}
