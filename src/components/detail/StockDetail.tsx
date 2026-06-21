import { useEffect, useRef, type JSX } from 'react';
import * as M from '../../lib/market';
import type { Stock, Rule, IndicatorDef } from '../../lib/market';
import type { Panels } from '../../store';
import { HButton } from '../ui/Hoverable';

// ----------------------------------------------------------------------------
// Faithful React port of poc/StockDetail.dc.html. The header/tiles/toggles and
// "screen criteria" list render in JSX; the candlestick chart is the POC's
// imperative `draw()` running inside a useEffect against a <canvas ref>. View
// (pan/zoom) and full-history indicator caches live in refs so handlers and
// redraws share them without re-rendering React.
// ----------------------------------------------------------------------------

type FullInd = {
  ema9: number[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  volAvg20: (number | null)[];
  macdLine: number[];
  macdSignal: number[];
  macdHist: number[];
  stochK: (number | null)[];
  stochD: (number | null)[];
};

type View = { start: number; count: number };

export interface StockDetailProps {
  stock: Stock;
  panels: Panels;
  rules: Rule[];
  onClose: () => void;
  onTogglePanel: (k: keyof Panels) => void;
  ruleLabel: (r: Rule) => string;
}

const fmtPrice = (v: number) => '$' + v.toFixed(2);
const col = (c: number) => (c >= 0 ? '#06a96b' : '#e23d3d');

// tiny "why did this fire" sparkline for a single rule over recent bars
function whySpark(stock: Stock, rule: Rule, pass: boolean): JSX.Element | null {
  if (rule.kind === 'rank') return null;
  const W = 134, H = 30, N = 46;
  const L = stock.full.c.length, start = Math.max(0, L - N);
  const idxs: number[] = [];
  for (let i = start; i < L; i++) idxs.push(i);
  const color = pass ? '#06a96b' : '#9aa1a8';
  let mainVals: (number | null)[] | null = null;
  let refVals: (number | null)[] | null = null;
  let thr: number | null = null;
  const marks: number[] = [];
  try {
    if (rule.kind === 'ind') {
      const Lr = M.indSeries(stock, rule.left);
      mainVals = idxs.map((i) => Lr[i]);
      if (rule.rhs) {
        if (rule.rhs.type === 'const') thr = +rule.rhs.value;
        else if (rule.rhs.type === 'price') refVals = idxs.map((i) => stock.full.c[i]);
        else if (rule.rhs.type === 'ind') { const Rr = M.indSeries(stock, rule.rhs.def); refVals = idxs.map((i) => Rr[i]); }
      }
    } else if (rule.kind === 'chain') {
      const op0 = rule.operands && rule.operands[0];
      const arr = op0 && op0.type === 'ind' ? M.indSeries(stock, op0.def) : stock.full.c;
      mainVals = idxs.map((i) => arr[i]);
      idxs.forEach((i, k) => { if (M.evalChainAt(stock, rule, i)) marks.push(k); });
    } else if (rule.kind === 'group') {
      const op0 = rule.conds && rule.conds[0] && rule.conds[0].left;
      const arr = op0 && op0.kind === 'ind' ? M.indSeries(stock, op0.def) : stock.full.c;
      mainVals = idxs.map((i) => arr[i]);
      idxs.forEach((i, k) => { if (M.evalGroupAt(stock, rule, i)) marks.push(k); });
    } else if (rule.kind === 'pattern') {
      mainVals = idxs.map((i) => stock.full.c[i]);
      idxs.forEach((i, k) => { if (M.evalPatternAt(stock, rule, i)) marks.push(k); });
    } else if (rule.kind === 'flag') {
      mainVals = idxs.map((i) => stock.full.c[i]);
      idxs.forEach((i, k) => { const sn = stock.snapAbs(i); if (sn[rule.field]) marks.push(k); });
    } else {
      const r = rule as M.NumRule;
      mainVals = idxs.map((i) => { const sn = stock.snapAbs(i); return sn[r.field] as number; });
      if (r.op === 'gt' || r.op === 'lt') thr = +(r.value as number);
    }
  } catch { return null; }
  if (!mainVals) return null;
  const allv = mainVals.filter((v): v is number => v != null && !isNaN(v)).slice();
  if (refVals) for (const v of refVals) if (v != null && !isNaN(v)) allv.push(v);
  if (thr != null && !isNaN(thr)) allv.push(thr);
  if (allv.length < 2) return null;
  const mn = Math.min(...allv), mx = Math.max(...allv), rng = (mx - mn) || 1;
  const px = (k: number) => (k / (mainVals!.length - 1)) * (W - 4) + 2;
  const py = (v: number) => H - 3 - ((v - mn) / rng) * (H - 6);
  const pts = (arr: (number | null)[]) =>
    arr.map((v, k) => (v == null || isNaN(v)) ? null : `${px(k).toFixed(1)},${py(v).toFixed(1)}`).filter(Boolean).join(' ');
  const kids: JSX.Element[] = [];
  if (thr != null && !isNaN(thr)) kids.push(<line key="t" x1={2} x2={W - 2} y1={py(thr)} y2={py(thr)} stroke="#c9ced3" strokeWidth={1} strokeDasharray="3 3" />);
  if (refVals) kids.push(<polyline key="r" points={pts(refVals)} fill="none" stroke="#cfd4d8" strokeWidth={1.2} />);
  kids.push(<polyline key="m" points={pts(mainVals)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />);
  for (const k of marks) kids.push(<circle key={'mk' + k} cx={px(k)} cy={H - 2.5} r={1.8} fill={color} />);
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>{kids}</svg>;
}

export function StockDetail({ stock, panels, rules, onClose, onTogglePanel, ruleLabel }: StockDetailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const viewKeyRef = useRef<string | null>(null);
  const fullRef = useRef<FullInd | null>(null);
  const fullKeyRef = useRef<string | null>(null);
  const datesRef = useRef<Date[] | null>(null);
  const LRef = useRef<number>(0);
  const dragRef = useRef<{ x: number; start: number } | null>(null);

  // keep the latest props available to the imperative draw / handlers
  const stockR = useRef(stock); stockR.current = stock;
  const panelsR = useRef(panels); panelsR.current = panels;
  const rulesR = useRef(rules); rulesR.current = rules;

  // weekday dates across the FULL history, ending "today"
  const datesFull = (L: number): Date[] => {
    if (datesRef.current && datesRef.current.length === L) return datesRef.current;
    const out: Date[] = []; const d = new Date(2026, 5, 19);
    while (out.length < L) { const day = d.getDay(); if (day !== 0 && day !== 6) out.push(new Date(d)); d.setDate(d.getDate() - 1); }
    datesRef.current = out.reverse();
    return datesRef.current;
  };

  // full-history indicator arrays, computed once per stock
  const ensureFull = (s: Stock): FullInd => {
    if (fullKeyRef.current === s.ticker && fullRef.current) return fullRef.current;
    const c = s.full.c, v = s.full.v as number[];
    const f: FullInd = {
      ema9: M.ema(c, 9), ema20: M.ema(c, 20), ema50: M.ema(c, 50), ema200: M.ema(c, 200),
      rsi: M.rsi(c, 14), volAvg20: M.sma(v, 20),
      macdLine: [], macdSignal: [], macdHist: [], stochK: [], stochD: [],
    };
    const mac = M.macd(c); f.macdLine = mac.line; f.macdSignal = mac.signal; f.macdHist = mac.hist;
    const sr = M.stochRsi(f.rsi, 14, 3, 3); f.stochK = sr.k; f.stochD = sr.d;
    fullRef.current = f; fullKeyRef.current = s.ticker;
    return f;
  };

  // ----- viewport (pan / zoom over time) -----
  const initView = (s: Stock) => {
    const L = s.full.c.length;
    LRef.current = L;
    if (viewKeyRef.current !== s.ticker || !viewRef.current) {
      const count = Math.min(s.visStart != null ? (L - s.visStart) : 130, L);
      viewRef.current = { start: Math.max(0, L - count), count };
      viewKeyRef.current = s.ticker;
    }
  };
  const clampView = () => {
    const L = LRef.current, view = viewRef.current!;
    view.count = Math.max(15, Math.min(L, Math.round(view.count)));
    view.start = Math.max(0, Math.min(L - view.count, Math.round(view.start)));
  };
  const plotW = () => { const cv = canvasRef.current!; const cssW = Math.max(320, cv.parentElement!.clientWidth - 28); return cssW - 6 - 58; };
  const barAtX = (clientX: number) => {
    const cv = canvasRef.current!, view = viewRef.current!;
    const rect = cv.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left - 6) / plotW()));
    return view.start + frac * view.count;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const view = viewRef.current; if (!view) return;
    const anchor = barAtX(e.clientX);
    const fracPos = (anchor - view.start) / view.count;
    view.count *= (e.deltaY > 0 ? 1.18 : 1 / 1.18);
    view.start = anchor - fracPos * view.count;
    clampView(); draw();
  };
  const onPointerDown = (e: PointerEvent) => {
    const view = viewRef.current; if (!view) return;
    dragRef.current = { x: e.clientX, start: view.start };
    const cv = canvasRef.current!;
    cv.style.cursor = 'grabbing';
    if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
  };
  const onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current; if (!drag) return;
    const view = viewRef.current!;
    const barsPerPx = view.count / plotW();
    view.start = drag.start - (e.clientX - drag.x) * barsPerPx;
    clampView(); draw();
  };
  const onPointerUp = () => { dragRef.current = null; if (canvasRef.current) canvasRef.current.style.cursor = 'grab'; };
  const resetView = () => { viewKeyRef.current = null; viewRef.current = null; draw(); };

  function draw() {
    const cv = canvasRef.current, s = stockR.current;
    if (!cv || !s) return;
    initView(s); clampView();
    const F = ensureFull(s);
    const o = s.full.o, h = s.full.h, l = s.full.l, c = s.full.c, vol = s.full.v as number[];
    const view = viewRef.current!;
    const start = view.start, N = view.count;

    const wrap = cv.parentElement!;
    const cssW = Math.max(320, wrap.clientWidth - 28);
    const P = panelsR.current;
    const bands: [string, number][] = [['price', 290]];
    if (P.volume) bands.push(['volume', 78]);
    if (P.macd) bands.push(['macd', 110]);
    if (P.rsi) bands.push(['rsi', 96]);
    if (P.stoch) bands.push(['stoch', 96]);
    const gap = 16, padT = 6, padB = 22;
    const cssH = padT + padB + bands.reduce((a, b) => a + b[1], 0) + gap * (bands.length - 1);
    const dpr = window.devicePixelRatio || 1;
    cv.width = cssW * dpr; cv.height = cssH * dpr;
    cv.style.height = cssH + 'px';
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 6, padR = 58, plotWd = cssW - padL - padR;

    // price-scale custom indicators referenced by rules -> full overlay series
    const ovDefs: IndicatorDef[] = [];
    const ovFull = new Map<string, (number | null)[]>();
    {
      const seenSig = new Set<string>();
      for (const rr of (rulesR.current || [])) {
        let cand: IndicatorDef[];
        if (rr.kind === 'ind') { cand = [rr.left]; if (rr.rhs && rr.rhs.type === 'ind') cand.push(rr.rhs.def); }
        else if (rr.kind === 'chain') { cand = (rr.operands || []).filter((op) => op.type === 'ind').map((op) => (op as { def: IndicatorDef }).def); }
        else continue;
        for (const d of cand) {
          if (!M.isPriceScale(d)) continue;
          const sg = M.defSig(d);
          if (seenSig.has(sg)) continue; seenSig.add(sg);
          ovDefs.push(d); ovFull.set(sg, M.indSeries(s, d));
        }
      }
    }

    const x = (i: number) => padL + (i + 0.5) * (plotWd / N);
    const cw = Math.max(1.5, (plotWd / N) * 0.62);
    const UP = '#06a96b', DN = '#e23d3d', GRID = '#eef0f1', TXT = '#9aa1a8';
    const dates = datesFull(LRef.current);

    // month separators within view
    const monthX: [number, Date][] = [];
    for (let i = 1; i < N; i++) { const a = start + i; if (dates[a].getMonth() !== dates[a - 1].getMonth()) monthX.push([i, dates[a]]); }

    let y0 = padT;
    const band = (hh: number) => { const r = { top: y0, h: hh }; y0 += hh + gap; return r; };

    ctx.font = "11px 'Helvetica Neue',Helvetica,Arial,sans-serif";
    ctx.textBaseline = 'middle';

    const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const drawMonthLines = (b: { top: number; h: number }) => {
      ctx.strokeStyle = '#f4f5f6'; ctx.lineWidth = 1;
      monthX.forEach(([i]) => { ctx.beginPath(); ctx.moveTo(x(i), b.top); ctx.lineTo(x(i), b.top + b.h); ctx.stroke(); });
    };

    // ---------- PRICE ----------
    const pb = band(bands[0][1]);
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < N; i++) { const a = start + i; if (h[a] > hi) hi = h[a]; if (l[a] < lo) lo = l[a]; }
    if (P.ema) for (const k of ['ema9', 'ema20', 'ema50', 'ema200'] as const) for (let i = 0; i < N; i++) { const v = F[k][start + i]; if (v != null) { if (v > hi) hi = v; if (v < lo) lo = v; } }
    for (const od of ovDefs) { const arr = ovFull.get(M.defSig(od)); if (!arr) continue; for (let i = 0; i < N; i++) { const v = arr[start + i]; if (v != null && !isNaN(v)) { if (v > hi) hi = v; if (v < lo) lo = v; } } }
    const pad = (hi - lo) * 0.06 || 1; hi += pad; lo -= pad;
    const py = (v: number) => pb.top + (1 - (v - lo) / (hi - lo)) * pb.h;
    drawMonthLines(pb);
    // gridlines + right axis
    ctx.strokeStyle = GRID; ctx.fillStyle = TXT; ctx.lineWidth = 1; ctx.textAlign = 'left';
    for (let g = 0; g <= 4; g++) {
      const val = lo + (hi - lo) * (g / 4); const yy = py(val);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotWd, yy); ctx.stroke();
      ctx.fillText(val.toFixed(val < 50 ? 2 : 1), padL + plotWd + 6, yy);
    }
    // candles
    for (let i = 0; i < N; i++) {
      const a = start + i, up = c[a] >= o[a], color = up ? UP : DN, cx = x(i);
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, py(h[a])); ctx.lineTo(cx, py(l[a])); ctx.stroke();
      const yo = py(o[a]), yc = py(c[a]);
      ctx.fillStyle = color;
      ctx.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1.2, Math.abs(yc - yo)));
    }
    // EMA overlays
    if (P.ema) {
      const emas: [keyof FullInd, string][] = [['ema9', '#2b6cff'], ['ema20', '#f5a623'], ['ema50', '#9b51e0'], ['ema200', '#8a929a']];
      for (const [k, c2] of emas) {
        ctx.strokeStyle = c2; ctx.lineWidth = 1.6; ctx.beginPath();
        let started = false;
        for (let i = 0; i < N; i++) { const v = F[k][start + i]; if (v == null) continue; const px = x(i), pyy = py(v); if (!started) { ctx.moveTo(px, pyy); started = true; } else ctx.lineTo(px, pyy); }
        ctx.stroke();
      }
      ctx.textAlign = 'left'; let lx = padL + 4;
      for (const [k, c2] of emas) { const lbl = (k as string).replace('ema', 'EMA '); ctx.fillStyle = c2; ctx.fillRect(lx, pb.top + 6, 12, 3); ctx.fillStyle = '#6b7280'; ctx.fillText(lbl, lx + 16, pb.top + 8); lx += ctx.measureText(lbl).width + 34; }
    }

    // custom saved-indicator overlays (price-scale) — dashed
    if (ovDefs.length) {
      ctx.textAlign = 'left'; let lx2 = padL + 4; const ly = P.ema ? pb.top + 24 : pb.top + 8;
      for (const od of ovDefs) {
        const arr = ovFull.get(M.defSig(od)); if (!arr) continue;
        const c2 = od.color || '#e2649b';
        ctx.strokeStyle = c2; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]); ctx.beginPath();
        let st2 = false;
        for (let i = 0; i < N; i++) { const v = arr[start + i]; if (v == null) continue; const px = x(i), pyy = py(v); if (!st2) { ctx.moveTo(px, pyy); st2 = true; } else ctx.lineTo(px, pyy); }
        ctx.stroke(); ctx.setLineDash([]);
        const lbl = od.name || M.autoIndName(od);
        ctx.fillStyle = c2; ctx.fillRect(lx2, ly - 2, 12, 3); ctx.fillStyle = '#6b7280'; ctx.fillText(lbl, lx2 + 16, ly); lx2 += ctx.measureText(lbl).width + 34;
      }
    }
    // markers where screen criteria met
    if (P.markers && rulesR.current && rulesR.current.length) {
      ctx.fillStyle = UP;
      for (let i = 0; i < N; i++) {
        const a = start + i;
        if (M.evalGroupedRules(s, rulesR.current, a)) {
          const cx = x(i), yy = py(l[a]) + 10;
          ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx - 4, yy + 7); ctx.lineTo(cx + 4, yy + 7); ctx.closePath(); ctx.fill();
        }
      }
    }

    // ---------- VOLUME ----------
    if (P.volume) {
      const vb = band(78);
      let vmax = 0; for (let i = 0; i < N; i++) { const v = vol[start + i]; if (v > vmax) vmax = v; }
      vmax = vmax || 1;
      drawMonthLines(vb);
      for (let i = 0; i < N; i++) {
        const a = start + i, up = c[a] >= o[a];
        const hh = (vol[a] / vmax) * (vb.h - 4);
        ctx.fillStyle = up ? 'rgba(6,169,107,0.45)' : 'rgba(226,61,61,0.4)';
        ctx.fillRect(x(i) - cw / 2, vb.top + vb.h - hh, cw, hh);
      }
      ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false;
      for (let i = 0; i < N; i++) { const v = F.volAvg20[start + i]; if (v == null) continue; const yy = vb.top + vb.h - (v / vmax) * (vb.h - 4); if (!st) { ctx.moveTo(x(i), yy); st = true; } else ctx.lineTo(x(i), yy); }
      ctx.stroke();
      ctx.fillStyle = TXT; ctx.textAlign = 'left'; ctx.fillText('Volume', padL + 4, vb.top + 9);
    }

    // ---------- MACD ----------
    if (P.macd) {
      const mb = band(110);
      let mx = 0; for (let i = 0; i < N; i++) { const a = start + i; mx = Math.max(mx, Math.abs(F.macdLine[a]), Math.abs(F.macdSignal[a]), Math.abs(F.macdHist[a])); }
      mx = mx || 1;
      const my = (v: number) => mb.top + (1 - (v + mx) / (2 * mx)) * mb.h;
      drawMonthLines(mb);
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(padL, my(0)); ctx.lineTo(padL + plotWd, my(0)); ctx.stroke();
      for (let i = 0; i < N; i++) { const hh = F.macdHist[start + i]; if (hh == null) continue; ctx.fillStyle = hh >= 0 ? 'rgba(6,169,107,0.55)' : 'rgba(226,61,61,0.5)'; const y1 = my(0), y2 = my(hh); ctx.fillRect(x(i) - cw / 2, Math.min(y1, y2), cw, Math.max(1, Math.abs(y2 - y1))); }
      const line = (arr: number[], c2: string) => { ctx.strokeStyle = c2; ctx.lineWidth = 1.5; ctx.beginPath(); let st = false; for (let i = 0; i < N; i++) { const v = arr[start + i]; if (v == null) continue; if (!st) { ctx.moveTo(x(i), my(v)); st = true; } else ctx.lineTo(x(i), my(v)); } ctx.stroke(); };
      line(F.macdLine, '#2b6cff'); line(F.macdSignal, '#f5a623');
      ctx.fillStyle = TXT; ctx.textAlign = 'left'; ctx.fillText('MACD 12,26,9', padL + 4, mb.top + 9);
    }

    // ---------- RSI ----------
    if (P.rsi) {
      const rb = band(96);
      const ry = (v: number) => rb.top + (1 - v / 100) * rb.h;
      drawMonthLines(rb);
      ctx.strokeStyle = '#f0e2e2'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, ry(70)); ctx.lineTo(padL + plotWd, ry(70)); ctx.stroke();
      ctx.strokeStyle = '#dceee0'; ctx.beginPath(); ctx.moveTo(padL, ry(30)); ctx.lineTo(padL + plotWd, ry(30)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#9b51e0'; ctx.lineWidth = 1.6; ctx.beginPath(); let st = false;
      for (let i = 0; i < N; i++) { const v = F.rsi[start + i]; if (v == null) continue; if (!st) { ctx.moveTo(x(i), ry(v)); st = true; } else ctx.lineTo(x(i), ry(v)); } ctx.stroke();
      ctx.fillStyle = TXT; ctx.textAlign = 'left'; ctx.fillText('RSI 14', padL + 4, rb.top + 9);
      ctx.fillStyle = '#c0b3c9'; ctx.fillText('70', padL + plotWd + 6, ry(70)); ctx.fillText('30', padL + plotWd + 6, ry(30));
    }

    // ---------- STOCH RSI ----------
    if (P.stoch) {
      const sb = band(96);
      const sy = (v: number) => sb.top + (1 - v / 100) * sb.h;
      drawMonthLines(sb);
      ctx.strokeStyle = '#eef0f1'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, sy(80)); ctx.lineTo(padL + plotWd, sy(80)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(padL, sy(20)); ctx.lineTo(padL + plotWd, sy(20)); ctx.stroke(); ctx.setLineDash([]);
      const sl = (arr: (number | null)[], c2: string) => { ctx.strokeStyle = c2; ctx.lineWidth = 1.5; ctx.beginPath(); let st = false; for (let i = 0; i < N; i++) { const v = arr[start + i]; if (v == null) continue; if (!st) { ctx.moveTo(x(i), sy(v)); st = true; } else ctx.lineTo(x(i), sy(v)); } ctx.stroke(); };
      sl(F.stochK, '#2b6cff'); sl(F.stochD, '#f5a623');
      ctx.fillStyle = TXT; ctx.textAlign = 'left'; ctx.fillText('Stoch RSI 14,3,3', padL + 4, sb.top + 9);
    }

    // month labels at very bottom
    ctx.fillStyle = '#b8bec4'; ctx.textAlign = 'center';
    monthX.forEach(([i, d]) => { ctx.fillText(mNames[d.getMonth()], x(i), cssH - 8); });
  }

  // wire canvas listeners + ResizeObserver once
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.style.cursor = 'grab'; cv.style.touchAction = 'none';
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointerleave', onPointerUp);
    cv.addEventListener('dblclick', resetView);
    const ro = new ResizeObserver(() => draw());
    ro.observe(cv.parentElement!);
    draw();
    return () => {
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerdown', onPointerDown);
      cv.removeEventListener('pointermove', onPointerMove);
      cv.removeEventListener('pointerup', onPointerUp);
      cv.removeEventListener('pointerleave', onPointerUp);
      cv.removeEventListener('dblclick', resetView);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // redraw when stock / panels / rules change
  useEffect(() => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stock, panels, rules]);

  // ---- view-model (renderVals 430–491) ----
  const s = stock;
  const up = s.changePct >= 0;
  const trend: [string, string] = s.ema20 > s.ema50 && s.ema50 > s.ema200 ? ['Strong up', '#06a96b']
    : s.ema50 > s.ema200 ? ['Uptrend', '#06a96b']
      : s.ema20 < s.ema50 && s.ema50 < s.ema200 ? ['Downtrend', '#e23d3d'] : ['Mixed', '#6b7280'];

  const tiles = [
    { label: 'RSI 14', value: s.rsi.toFixed(1), color: s.rsi > 70 ? '#e23d3d' : s.rsi < 30 ? '#06a96b' : '#15171a' },
    { label: 'MACD hist', value: s.macdHist.toFixed(3), color: col(s.macdHist) },
    { label: 'Stoch %K', value: s.stochK.toFixed(1), color: s.stochK > 80 ? '#e23d3d' : s.stochK < 20 ? '#06a96b' : '#15171a' },
    { label: 'Rel volume', value: s.relVol.toFixed(2) + '×', color: s.relVol > 1.5 ? '#06a96b' : '#15171a' },
    { label: 'Trend', value: trend[0], color: trend[1] },
    { label: '52w range', value: s.pct52w.toFixed(0) + '%', color: '#15171a' },
  ];

  const toggleDefs: [keyof Panels, string, string][] = [
    ['ema', 'EMA', '#2b6cff'], ['volume', 'Volume', '#f5a623'], ['macd', 'MACD', '#2b6cff'],
    ['rsi', 'RSI', '#9b51e0'], ['stoch', 'Stoch RSI', '#2b6cff'], ['markers', 'Signal markers', '#06a96b'],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff', fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif", color: '#15171a', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', borderBottom: '1px solid #ececef', flex: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{s.ticker}</span>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{s.name}</span>
          </div>
          <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.sector}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(s.price)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: col(s.changePct) }}>{(up ? '+' : '') + s.changePct.toFixed(2) + '%'}</span>
        </div>
        <HButton onClick={onClose} style={{ marginLeft: 8, width: 34, height: 34, border: '1px solid #ececef', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }} hoverStyle={{ background: '#f5f6f7' }}>✕</HButton>
      </div>

      {/* stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 1, background: '#ececef', borderBottom: '1px solid #ececef', flex: 'none' }}>
        {tiles.map((t, i) => (
          <div key={i} style={{ background: '#fff', padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.label}</span>
            <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: t.color }}>{t.value}</span>
          </div>
        ))}
      </div>

      {/* panel toggles */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 22px', flexWrap: 'wrap', borderBottom: '1px solid #f2f3f4', flex: 'none' }}>
        {toggleDefs.map(([k, label, dot]) => {
          const on = panels[k];
          return (
            <button key={k} onClick={() => onTogglePanel(k)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 7, border: `1px solid ${on ? '#d7e6ff' : '#ececef'}`, background: on ? '#f4f8ff' : '#fff', color: on ? '#15171a' : '#9aa1a8', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: on ? dot : '#cfd4d8', display: 'inline-block' }} />
              {label}
            </button>
          );
        })}
      </div>

      {/* chart + matches, scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', padding: '8px 14px 0 14px' }}>
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
        </div>

        <div style={{ padding: '16px 22px 22px 22px' }}>
          <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Screen criteria — this stock</div>
          {rules.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {rules.map((r, i) => {
                const pass = r.kind === 'rank' ? !!r._pass : M.evalRuleAt(s, r, s.nLast);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: pass ? '#06a96b' : '#cfd4d8', flex: 'none' }}>{pass ? '✓' : '✕'}</span>
                    <span style={{ color: pass ? '#15171a' : '#9aa1a8', flex: 1, minWidth: 0 }}>{ruleLabel(r)}</span>
                    <span style={{ flex: 'none', opacity: 0.92 }}>{whySpark(s, r, pass)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#98a0a8' }}>No filters active — showing the full chart with overlays.</div>
          )}
        </div>
      </div>
    </div>
  );
}
