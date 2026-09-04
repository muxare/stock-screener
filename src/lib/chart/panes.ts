// Shared sub-pane renderers for the MACD and Stochastic-RSI indicator panels
// drawn beneath the price/volume area on candlestick charts. Extracted so the
// detail and trade-review charts render them identically.

export interface MacdSeries {
  line: number[];
  signal: number[];
  hist: number[];
}

export interface StochSeries {
  k: (number | null)[];
  d: (number | null)[];
}

interface PaneBase {
  ctx: CanvasRenderingContext2D;
  from: number;
  to: number;
  x: (i: number) => number;
  top: number;
  height: number;
  plotLeft: number;
  plotW: number;
}

const FONT = "10px 'Helvetica Neue', Helvetica, Arial, sans-serif";

function paneLine(
  ctx: CanvasRenderingContext2D,
  arr: (number | null)[],
  x: (i: number) => number,
  ty: (v: number) => number,
  from: number,
  to: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let started = false;
  for (let i = from; i <= to; i++) {
    const v = arr[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!started) { ctx.moveTo(x(i), ty(v)); started = true; }
    else ctx.lineTo(x(i), ty(v));
  }
  ctx.stroke();
}

export function drawMacdPane({
  ctx, macd, from, to, x, top, height, plotLeft, plotW, cw, label = 'MACD 12/26/9',
}: PaneBase & { macd: MacdSeries; cw: number; label?: string }) {
  let mLo = 0, mHi = 0;
  for (let i = from; i <= to; i++) {
    for (const v of [macd.line[i], macd.signal[i], macd.hist[i]]) {
      if (!Number.isFinite(v)) continue;
      if (v < mLo) mLo = v;
      if (v > mHi) mHi = v;
    }
  }
  if (!(mHi > mLo)) { mLo = -1; mHi = 1; }
  const mPad = (mHi - mLo) * 0.08;
  mLo -= mPad; mHi += mPad;
  const my = (v: number) => top + (1 - (v - mLo) / (mHi - mLo)) * height;

  ctx.fillStyle = '#f7f8f8';
  ctx.fillRect(plotLeft, top, plotW, height);
  const zeroY = my(0);
  ctx.strokeStyle = '#e7e8ea';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(plotLeft, zeroY); ctx.lineTo(plotLeft + plotW, zeroY); ctx.stroke();
  for (let i = from; i <= to; i++) {
    const hv = macd.hist[i];
    if (!Number.isFinite(hv)) continue;
    const hy = my(hv);
    ctx.fillStyle = hv >= 0 ? 'rgba(6,169,107,0.45)' : 'rgba(226,61,61,0.4)';
    ctx.fillRect(x(i) - cw / 2, Math.min(zeroY, hy), cw, Math.max(1, Math.abs(hy - zeroY)));
  }
  paneLine(ctx, macd.line, x, my, from, to, '#3aa0ff');
  paneLine(ctx, macd.signal, x, my, from, to, '#d9871f');
  ctx.fillStyle = '#9aa1a8';
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, plotLeft + 4, top + 3);
}

export function drawStochPane({
  ctx, stoch, from, to, x, top, height, plotLeft, plotW, label = 'Stoch RSI',
}: PaneBase & { stoch: StochSeries; label?: string }) {
  const sy = (v: number) => top + (1 - v / 100) * height;
  ctx.fillStyle = '#f7f8f8';
  ctx.fillRect(plotLeft, top, plotW, height);
  ctx.strokeStyle = '#e7e8ea';
  ctx.setLineDash([3, 3]);
  for (const lvl of [20, 80]) {
    const yy = sy(lvl);
    ctx.beginPath(); ctx.moveTo(plotLeft, yy); ctx.lineTo(plotLeft + plotW, yy); ctx.stroke();
  }
  ctx.setLineDash([]);
  paneLine(ctx, stoch.k, x, sy, from, to, '#06a96b');
  paneLine(ctx, stoch.d, x, sy, from, to, '#9b51e0');
  ctx.fillStyle = '#9aa1a8';
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, plotLeft + 4, top + 3);
}
