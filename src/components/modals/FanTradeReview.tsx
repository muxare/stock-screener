import { useEffect, useMemo, useRef, useState } from 'react';
import type { Stock } from '../../lib/market';
import { ema, macd, rsi, stochRsi } from '../../lib/indicators';
import {
  explainFanTrade,
  tradeChartRange,
  type FanEntryEvent,
} from '../../lib/fanBacktest';
import { useChartViewport } from '../../lib/chart/viewport';
import { barIndexAtX, drawZoomSelection, isInPlot, type ZoomSelection } from '../../lib/chart/interactions';
import { drawMacdPane, drawStochPane } from '../../lib/chart/panes';
import { HButton } from '../ui/Hoverable';
import { ChartControls } from '../ui/ChartControls';

const PRICE_H = 220;
const VOL_H = 44;
const MACD_H = 52;
const STOCH_H = 52;
const PAD_T = 28;
const PAD_B = 18;
const UP = '#06a96b';
const DN = '#e23d3d';
const STOP = '#e23d3d';
const ENTRY = '#06865a';
const TARGET = '#d9871f';
const E18 = '#06a96b';
const E50 = '#3aa0ff';
const E100 = '#d9871f';
const E200 = '#9b51e0';
const FAN = '#7c5cbf';
const IMPULSE = '#c47a14';

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

const spinner = (
  <div style={{ width: 26, height: 26, border: '3px solid #ececef', borderTopColor: '#9aa1a8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
);

export function FanTradeReview({
  event,
  stock,
  status,
  trailEma,
  onClose,
  onRetry,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
}: {
  event: FanEntryEvent;
  stock: Stock | null;
  status: 'loading' | 'loaded' | 'error' | undefined;
  trailEma: 18 | 50 | null;
  onClose: () => void;
  onRetry: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  position?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef({ padL: 8, plotW: 1, visible: 1, from: 0, to: 0, bottom: 0 });
  const dragRef = useRef({ active: false, lastX: 0, acc: 0 });
  const selectionRef = useRef<ZoomSelection>({ active: false, startBar: 0, endBar: 0 });
  const [macdOn, setMacdOn] = useState(true);
  const [stochOn, setStochOn] = useState(true);

  const story = explainFanTrade(event);
  const trade = event.trade;
  const rColor = (trade?.realizedR ?? 0) >= 0 ? UP : DN;

  const total = stock ? stock.full.c.length : 0;

  const defWin = useMemo(() => {
    if (!stock) return { from: 0, to: 0 };
    const L = stock.full.c.length;
    const entryBar = trade?.entryBar ?? event.barIndex;
    const exitBar = trade?.exitBar ?? entryBar;
    const fanBar = event.fanBar ?? event.barIndex;
    const reactionBar = event.reactionBar ?? event.barIndex;
    const impulseBar = event.impulseBar ?? fanBar;
    return tradeChartRange(entryBar, exitBar, L, 80, 20, [fanBar, impulseBar, reactionBar]);
  }, [stock, event, trade]);

  const series = useMemo(() => {
    if (!stock) return null;
    const c = stock.full.c;
    return {
      e18: ema(c, 18),
      e50: ema(c, 50),
      e100: ema(c, 100),
      e200: ema(c, 200),
      macd: macd(c),
      stoch: stochRsi(rsi(c, 14), 14, 3, 3),
    };
  }, [stock]);

  const { view, zoomAtBar, panByBars, setRange, reset, isDefault } = useChartViewport(total, defWin);

  const chartH = PAD_T + PRICE_H + 10 + VOL_H
    + (macdOn ? 8 + MACD_H : 0)
    + (stochOn ? 8 + STOCH_H : 0)
    + PAD_B;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !stock || !series) return;
    const full = stock.full;
    const from = view.from, to = view.to;
    const N = to - from + 1;
    if (N < 1) return;

    const entryBar = trade?.entryBar ?? event.barIndex;
    const fanBar = event.fanBar ?? event.barIndex;
    const reactionBar = event.reactionBar ?? event.barIndex;
    const impulseBar = event.impulseBar ?? fanBar;

    const o = full.o ?? full.c;
    const h = full.h ?? full.c;
    const l = full.l ?? full.c;
    const c = full.c;
    const vol = full.v ?? [];
    const { e18, e50, e100, e200 } = series;

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

      const padL = 8, padR = 62, plotW = cssW - padL - padR;
      const x = (i: number) => padL + (i - from + 0.5) * (plotW / N);
      const cw = Math.max(2, (plotW / N) * 0.62);

      let hi = -Infinity, lo = Infinity;
      for (let i = from; i <= to; i++) {
        if (h[i] > hi) hi = h[i];
        if (l[i] < lo) lo = l[i];
        for (const v of [e18[i], e50[i], e100[i], e200[i]]) {
          if (v > hi) hi = v;
          if (v < lo) lo = v;
        }
      }
      if (trade) {
        hi = Math.max(hi, trade.entryPrice, trade.exitPrice, trade.targetPrice);
        lo = Math.min(lo, trade.stopPrice, trade.entryPrice, trade.exitPrice);
      }
      const pad = (hi - lo) * 0.08 || 1;
      hi += pad; lo -= pad;
      const py = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * PRICE_H;
      const volTop = PAD_T + PRICE_H + 10;
      let bottom = volTop + VOL_H;
      if (macdOn) bottom += 8 + MACD_H;
      if (stochOn) bottom += 8 + STOCH_H;
      layoutRef.current = { padL, plotW, visible: N, from, to, bottom };

      ctx.font = "11px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#eef0f1';
      ctx.fillStyle = '#9aa1a8';
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      for (let g = 0; g <= 4; g++) {
        const val = lo + (hi - lo) * (g / 4);
        const yy = py(val);
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText(val.toFixed(val < 50 ? 2 : 1), padL + plotW + 6, yy);
      }

      const setupLo = Math.min(fanBar, impulseBar, reactionBar);
      const setupHi = Math.max(fanBar, reactionBar);
      if (setupHi > setupLo) {
        const sx0 = x(Math.max(from, setupLo));
        const sx1 = x(Math.min(to, setupHi));
        ctx.fillStyle = 'rgba(124,92,191,0.08)';
        ctx.fillRect(Math.min(sx0, sx1), PAD_T, Math.max(4, Math.abs(sx1 - sx0)), PRICE_H);
      }

      if (trade) {
        const x0 = x(Math.max(from, trade.entryBar));
        const x1 = x(Math.min(to, trade.exitBar));
        ctx.fillStyle = trade.realizedR >= 0 ? 'rgba(6,169,107,0.08)' : 'rgba(226,61,61,0.08)';
        ctx.fillRect(Math.min(x0, x1), PAD_T, Math.max(4, Math.abs(x1 - x0)), PRICE_H);
      }

      let vmax = 0;
      for (let i = from; i <= to; i++) if ((vol[i] || 0) > vmax) vmax = vol[i];
      vmax = vmax || 1;

      for (let i = from; i <= to; i++) {
        const up = c[i] >= o[i], color = up ? UP : DN, cx = x(i);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, py(h[i])); ctx.lineTo(cx, py(l[i])); ctx.stroke();
        const yo = py(o[i]), yc = py(c[i]);
        ctx.fillStyle = color;
        ctx.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1.2, Math.abs(yc - yo)));
        const hh = ((vol[i] || 0) / vmax) * (VOL_H - 4);
        ctx.fillStyle = up ? 'rgba(6,169,107,0.45)' : 'rgba(226,61,61,0.4)';
        ctx.fillRect(cx - cw / 2, volTop + VOL_H - hh, cw, hh);
      }

      const line = (arr: number[], color: string, width = 1.6) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        let started = false;
        for (let i = from; i <= to; i++) {
          const v = arr[i];
          if (!Number.isFinite(v)) continue;
          if (!started) { ctx.moveTo(x(i), py(v)); started = true; }
          else ctx.lineTo(x(i), py(v));
        }
        ctx.stroke();
      };
      line(e18, E18);
      line(e50, E50, 2);
      line(e100, E100);
      line(e200, E200);

      const markLine = (bar: number, color: string) => {
        if (bar < from || bar > to) return;
        const cx = x(bar);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(cx, PAD_T); ctx.lineTo(cx, PAD_T + PRICE_H); ctx.stroke();
        ctx.setLineDash([]);
      };
      markLine(fanBar, FAN);
      if (impulseBar !== fanBar) markLine(impulseBar, IMPULSE);

      const diamond = (bar: number, price: number, color: string, tag: string) => {
        if (bar < from || bar > to) return;
        const cx = x(bar), cy = py(price), s = 5;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s, cy);
        ctx.lineTo(cx, cy + s);
        ctx.lineTo(cx - s, cy);
        ctx.closePath();
        ctx.fill();
        ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(tag, cx + 7, cy - 2);
      };
      diamond(fanBar, c[fanBar], FAN, 'fan');
      if (impulseBar !== fanBar && impulseBar !== reactionBar) {
        const cx = x(impulseBar), cy = py(h[impulseBar]);
        if (impulseBar >= from && impulseBar <= to) {
          ctx.fillStyle = IMPULSE;
          ctx.beginPath();
          ctx.moveTo(cx, cy + 8);
          ctx.lineTo(cx - 5, cy - 2);
          ctx.lineTo(cx + 5, cy - 2);
          ctx.closePath();
          ctx.fill();
          ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText('high', cx + 7, cy - 2);
        }
      }

      const hline = (price: number, color: string, dash: number[], tag: string) => {
        const yy = py(price);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(tag, padL + 4, yy - 8);
      };

      if (trade) {
        hline(trade.stopPrice, STOP, [4, 3], 'stop');
        hline(trade.entryPrice, ENTRY, [2, 3], 'entry');
        if (trailEma == null && trade.targetPrice > trade.entryPrice) {
          hline(trade.targetPrice, TARGET, [6, 4], 'target');
        }
      }

      if (entryBar >= from && entryBar <= to) {
        const cx = x(entryBar), cy = py(event.entryPrice);
        ctx.fillStyle = ENTRY;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 9);
        ctx.lineTo(cx - 6, cy + 3);
        ctx.lineTo(cx + 6, cy + 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = ENTRY;
        ctx.font = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(fanBar === entryBar ? 'fan / tag' : 'tag', cx + 8, cy - 6);
      }
      if (trade && trade.exitBar >= from && trade.exitBar <= to) {
        const cx = x(trade.exitBar), cy = py(trade.exitPrice);
        ctx.fillStyle = trade.realizedR >= 0 ? UP : DN;
        ctx.fillRect(cx - 4, cy - 4, 8, 8);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx - 4, cy - 4, 8, 8);
      }

      ctx.font = "11px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let lx = padL + 4;
      ctx.fillStyle = FAN;
      ctx.fillText('◆ fan', lx, 6);
      lx += ctx.measureText('◆ fan   ').width;
      ctx.fillStyle = IMPULSE;
      ctx.fillText('▾ high', lx, 6);
      lx += ctx.measureText('▾ high   ').width;
      ctx.fillStyle = '#6b7280';
      const prefix = '▲ tag   ■ exit   ';
      ctx.fillText(prefix, lx, 6);
      lx += ctx.measureText(prefix).width;
      for (const [lab, colr] of [['18', E18], ['50', E50], ['100', E100], ['200', E200]] as const) {
        ctx.fillStyle = colr;
        ctx.fillText(lab, lx, 6);
        lx += ctx.measureText(lab + '  ').width;
      }
      ctx.fillStyle = '#9aa1a8';
      ctx.fillText('Volume', padL + 4, volTop + 4);

      let cursorY = volTop + VOL_H + 8;
      if (macdOn) {
        drawMacdPane({ ctx, macd: series.macd, from, to, x, top: cursorY, height: MACD_H, plotLeft: padL, plotW, cw });
        cursorY += MACD_H + 8;
      }
      if (stochOn) {
        drawStochPane({ ctx, stoch: series.stoch, from, to, x, top: cursorY, height: STOCH_H, plotLeft: padL, plotW });
      }
    };

    const hideOverlay = () => {
      const ov = overlayRef.current;
      const g = ov?.getContext('2d');
      if (ov && g) {
        const dpr = window.devicePixelRatio || 1;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, ov.width, ov.height);
      }
    };

    const drawSelection = (mx: number, my: number) => {
      const ov = overlayRef.current, cvEl = canvasRef.current;
      if (!ov || !cvEl) return;
      const layout = layoutRef.current;
      if (!selectionRef.current.active || !isInPlot(mx, my, layout, PAD_T)) {
        hideOverlay();
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
      if (!dragRef.current.active) return;
      const { plotW, visible } = layoutRef.current;
      const barsPerPx = visible / Math.max(1, plotW);
      const dx = mx - dragRef.current.lastX;
      dragRef.current.lastX = mx;
      dragRef.current.acc += -dx * barsPerPx;
      const whole = Math.trunc(dragRef.current.acc);
      if (whole !== 0) { panByBars(whole); dragRef.current.acc -= whole; }
    };
    const onDown = (e: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const layout = layoutRef.current;
      if (e.shiftKey && isInPlot(mx, my, layout, PAD_T)) {
        const bar = barIndexAtX(mx, layout);
        selectionRef.current = { active: true, startBar: bar, endBar: bar };
        hideOverlay();
        cv.style.cursor = 'crosshair';
        drawSelection(mx, my);
        return;
      }
      dragRef.current = { active: true, lastX: mx, acc: 0 };
      cv.style.cursor = 'grabbing';
    };
    const endPointer = () => {
      if (selectionRef.current.active) {
        const { startBar, endBar } = selectionRef.current;
        selectionRef.current.active = false;
        hideOverlay();
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const { padL, plotW, visible } = layoutRef.current;
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
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mouseup', endPointer);
    return () => {
      ro.disconnect();
      cv.removeEventListener('mousemove', onMove);
      cv.removeEventListener('mousedown', onDown);
      cv.removeEventListener('wheel', onWheel);
      window.removeEventListener('mouseup', endPointer);
    };
  }, [stock, series, event, trade, trailEma, view.from, view.to, macdOn, stochOn, chartH, panByBars, zoomAtBar, setRange]);

  const center = (view.from + view.to) / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <HButton
          onClick={onClose}
          style={{ padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#5b6168' }}
          hoverStyle={{ background: '#f7f8f8' }}
        >
          ← Results
        </HButton>
        <HButton
          onClick={onPrev}
          disabled={!hasPrev}
          aria-label="Previous trade"
          style={{ padding: '7px 10px', border: '1px solid #e7e8ea', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, cursor: hasPrev ? 'pointer' : 'default', fontFamily: 'inherit', color: hasPrev ? '#5b6168' : '#c4c8cc' }}
          hoverStyle={hasPrev ? { background: '#f7f8f8' } : undefined}
        >
          ‹ Prev
        </HButton>
        <HButton
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next trade"
          style={{ padding: '7px 10px', border: '1px solid #e7e8ea', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, cursor: hasNext ? 'pointer' : 'default', fontFamily: 'inherit', color: hasNext ? '#5b6168' : '#c4c8cc' }}
          hoverStyle={hasNext ? { background: '#f7f8f8' } : undefined}
        >
          Next ›
        </HButton>
        {position && (
          <div style={{ fontSize: 12, color: '#8b9298', fontVariantNumeric: 'tabular-nums', paddingTop: 8 }}>{position}</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {event.ticker} <span style={{ fontWeight: 500, color: '#6b7280', fontSize: 13 }}>{event.name}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 650, color: rColor, marginTop: 2 }}>{story.headline}</div>
        </div>
        {trade && (
          <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: rColor }}>
              {trade.realizedR >= 0 ? '+' : ''}{fmt(trade.realizedR)}R
            </div>
            <div style={{ fontSize: 12, color: rColor }}>
              {trade.returnPct >= 0 ? '+' : ''}{fmt(trade.returnPct)}%
            </div>
          </div>
        )}
      </div>

      {status === 'error' ? (
        <div role="alert" style={{ padding: 28, textAlign: 'center', color: '#8a6321' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Couldn’t load {event.ticker}</div>
          <HButton
            onClick={onRetry}
            style={{ marginTop: 10, padding: '7px 14px', border: '1px solid #d9a85a', borderRadius: 8, background: '#fff', color: '#8a6321', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Retry
          </HButton>
        </div>
      ) : !stock ? (
        <div role="status" style={{ padding: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#9aa1a8' }}>
          {spinner}
          <div style={{ fontSize: 13, fontWeight: 600 }}>Loading {event.ticker}…</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          <div style={{ position: 'relative' }}>
            <canvas ref={canvasRef} role="img" aria-label={`${event.ticker} trade candlestick chart`} style={{ display: 'block' }} />
            <canvas ref={overlayRef} style={{ display: 'block', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: '#fafbfb', border: '1px solid #eef0f1', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#98a0a8', marginBottom: 6 }}>Entry</div>
          <div style={{ fontSize: 13, color: '#3b4046', lineHeight: 1.45 }}>{story.entry}</div>
          {event.indicators && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
              MACD hist {event.indicators.macdHist >= 0 ? '+' : ''}{fmt(event.indicators.macdHist, 3)}
              {' · '}line {fmt(event.indicators.macdLine, 3)} / signal {fmt(event.indicators.macdSignal, 3)}
              {' · '}Stoch {fmt(event.indicators.stochK, 1)}/{fmt(event.indicators.stochD, 1)}
            </div>
          )}
        </div>
        <div style={{ background: '#fafbfb', border: '1px solid #eef0f1', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#98a0a8', marginBottom: 6 }}>What happened</div>
          <div style={{ fontSize: 13, color: '#3b4046', lineHeight: 1.45 }}>{story.exit}</div>
          {story.excursion && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>{story.excursion}</div>
          )}
        </div>
      </div>
    </div>
  );
}
