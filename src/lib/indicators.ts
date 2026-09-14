// indicators.ts — the technical-indicator math.
//
// Pure, isomorphic, dependency-free: arrays in, arrays out, no notion of
// "today". These are the only numeric primitives the fan screener, backtest and
// signal scan are built on, and their output is pinned bar-for-bar by
// tests/engine.golden.test.ts. Do not change smoothing or warm-up behaviour
// without repinning that golden master deliberately.
//
// Conventions:
//   ema  — seeds on the first value; full-length output, no warm-up nulls.
//   sma  — null until a value arrives; a PARTIAL-window mean before `period`
//          values have accumulated, the true mean afterwards.
//   rsi  — Wilder smoothing; the first `period` bars are backfilled with the
//          first computed value (50 when the series is too short).
//   atr14 — Wilder true range, EMA-smoothed.
//   stochRsi / macd — composites over the above.

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev: number = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i === 0) prev = v;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0, cnt = 0;
  const q: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { out[i] = null; continue; }
    q.push(v); sum += v; cnt++;
    if (q.length > period) { sum -= q.shift() as number; cnt--; }
    out[i] = q.length === period ? sum / period : (cnt ? sum / cnt : null);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(50);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  out[period] = 100 - 100 / (1 + (loss === 0 ? 100 : gain / loss));
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    const rs = loss === 0 ? 100 : gain / loss;
    out[i] = 100 - 100 / (1 + rs);
  }
  for (let i = 0; i < period; i++) out[i] = out[period];
  return out;
}

export function stochRsi(
  rsiArr: number[],
  period = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: (number | null)[]; d: (number | null)[] } {
  const stoch: (number | null)[] = new Array(rsiArr.length).fill(null);
  for (let i = 0; i < rsiArr.length; i++) {
    if (i < period) { stoch[i] = null; continue; }
    let lo = Infinity, hi = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const r = rsiArr[j];
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    stoch[i] = hi === lo ? 0 : ((rsiArr[i] - lo) / (hi - lo)) * 100;
  }
  const k = sma(stoch, kSmooth);
  const d = sma(k, dSmooth);
  return { k, d };
}

export function macd(closes: number[]): { line: number[]; signal: number[]; hist: number[] } {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const line = closes.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

/**
 * Wilder-style ATR(14) over the true range, smoothed with `ema`. Bar 0's true
 * range is the bar's own high−low (there is no previous close); the output is
 * full-length, like `ema`.
 */
export function atr14(h: number[], l: number[], c: number[]): number[] {
  const tr = c.map((_, i) => {
    if (i === 0) return Math.max(h[0] - l[0], 0);
    return Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  });
  return ema(tr, 14);
}

// EMA window choices offered in the custom-rule builder
