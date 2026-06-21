// market.js — deterministic mock market universe + technical indicators
// Pure ES module. No dependencies. Exports generateUniverse() and helpers.

// ---------- seeded RNG ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- indicator math ----------
export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i === 0) prev = v;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0, cnt = 0;
  const q = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { out[i] = null; continue; }
    q.push(v); sum += v; cnt++;
    if (q.length > period) { sum -= q.shift(); cnt--; }
    out[i] = q.length === period ? sum / period : (cnt ? sum / cnt : null);
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(50);
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

export function stochRsi(rsiArr, period = 14, kSmooth = 3, dSmooth = 3) {
  const stoch = new Array(rsiArr.length).fill(null);
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

export function macd(closes) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const line = closes.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

// EMA window choices offered in the custom-rule builder
export const EMA_WINDOWS = [5, 8, 9, 10, 12, 20, 21, 26, 50, 100, 150, 200];

// ---------- universe ----------
const TICKERS = [
  ['AAPL', 'Apple Inc.', 'Technology'],
  ['MSFT', 'Microsoft Corp.', 'Technology'],
  ['NVDA', 'NVIDIA Corp.', 'Semiconductors'],
  ['AMD', 'Advanced Micro Devices', 'Semiconductors'],
  ['AVGO', 'Broadcom Inc.', 'Semiconductors'],
  ['GOOGL', 'Alphabet Inc.', 'Communication'],
  ['META', 'Meta Platforms', 'Communication'],
  ['AMZN', 'Amazon.com Inc.', 'Consumer Disc.'],
  ['TSLA', 'Tesla Inc.', 'Consumer Disc.'],
  ['NFLX', 'Netflix Inc.', 'Communication'],
  ['CRM', 'Salesforce Inc.', 'Technology'],
  ['ORCL', 'Oracle Corp.', 'Technology'],
  ['ADBE', 'Adobe Inc.', 'Technology'],
  ['INTC', 'Intel Corp.', 'Semiconductors'],
  ['QCOM', 'Qualcomm Inc.', 'Semiconductors'],
  ['MU', 'Micron Technology', 'Semiconductors'],
  ['PLTR', 'Palantir Technologies', 'Technology'],
  ['SNOW', 'Snowflake Inc.', 'Technology'],
  ['SHOP', 'Shopify Inc.', 'Technology'],
  ['UBER', 'Uber Technologies', 'Industrials'],
  ['ABNB', 'Airbnb Inc.', 'Consumer Disc.'],
  ['COIN', 'Coinbase Global', 'Financials'],
  ['SQ', 'Block Inc.', 'Financials'],
  ['PYPL', 'PayPal Holdings', 'Financials'],
  ['JPM', 'JPMorgan Chase', 'Financials'],
  ['BAC', 'Bank of America', 'Financials'],
  ['GS', 'Goldman Sachs', 'Financials'],
  ['V', 'Visa Inc.', 'Financials'],
  ['MA', 'Mastercard Inc.', 'Financials'],
  ['DIS', 'Walt Disney Co.', 'Communication'],
  ['NKE', 'Nike Inc.', 'Consumer Disc.'],
  ['SBUX', 'Starbucks Corp.', 'Consumer Disc.'],
  ['MCD', "McDonald's Corp.", 'Consumer Disc.'],
  ['COST', 'Costco Wholesale', 'Consumer Staples'],
  ['WMT', 'Walmart Inc.', 'Consumer Staples'],
  ['XOM', 'Exxon Mobil', 'Energy'],
  ['CVX', 'Chevron Corp.', 'Energy'],
  ['LLY', 'Eli Lilly & Co.', 'Healthcare'],
  ['UNH', 'UnitedHealth Group', 'Healthcare'],
  ['PFE', 'Pfizer Inc.', 'Healthcare'],
  ['BA', 'Boeing Co.', 'Industrials'],
  ['CAT', 'Caterpillar Inc.', 'Industrials'],
  ['GE', 'GE Aerospace', 'Industrials'],
  ['F', 'Ford Motor Co.', 'Consumer Disc.'],
];

const DAYS = 260;       // generated trading days (~1y)
const VISIBLE = 130;    // days shown on detail chart

function genSeries(rand, startPrice) {
  // regime-based geometric random walk with occasional trend shifts
  const closes = [];
  let price = startPrice;
  let drift = (rand() - 0.45) * 0.0016;      // slight bias
  let vol = 0.012 + rand() * 0.022;
  let regimeLeft = 20 + Math.floor(rand() * 40);
  for (let i = 0; i < DAYS; i++) {
    if (regimeLeft-- <= 0) {
      drift = (rand() - 0.5) * 0.004;
      vol = 0.01 + rand() * 0.03;
      regimeLeft = 20 + Math.floor(rand() * 45);
    }
    const shock = (rand() - 0.5) * 2;
    const ret = drift + vol * shock;
    price = Math.max(1.5, price * (1 + ret));
    closes.push(price);
  }
  // build OHLCV around closes
  const bars = [];
  const baseVol = 1.5e6 + rand() * 9e6;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const prevC = i ? closes[i - 1] : c;
    const o = prevC * (1 + (rand() - 0.5) * 0.01);
    const hi = Math.max(o, c) * (1 + rand() * 0.012);
    const lo = Math.min(o, c) * (1 - rand() * 0.012);
    const move = Math.abs(c - prevC) / prevC;
    const v = Math.round(baseVol * (0.6 + rand() * 0.8 + move * 14));
    bars.push({ o, h: hi, l: lo, c, v });
  }
  return bars;
}

function pct(a, b) { return ((a - b) / b) * 100; }

export function generateUniverse(seed = 7) {
  const rand = mulberry32(seed);
  const stocks = TICKERS.map(([ticker, name, sector], idx) => {
    const startPrice = 18 + rand() * 380;
    const bars = genSeries(mulberry32(seed * 131 + idx * 977), startPrice);
    const closes = bars.map(b => b.c);
    const vols = bars.map(b => b.v);

    const ema9 = ema(closes, 9);
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const rsiArr = rsi(closes, 14);
    const sr = stochRsi(rsiArr, 14, 3, 3);
    const mac = macd(closes);
    const volAvg20 = sma(vols, 20);
    const emaCache = {};
    const indExtra = {};
    for (const w of EMA_WINDOWS) { emaCache[w] = ema(closes, w); indExtra[w] = emaCache[w].slice(-VISIBLE); }

    const n = closes.length - 1;
    const price = closes[n];
    const changePct = pct(closes[n], closes[n - 1]);
    const hi52 = Math.max(...closes);
    const lo52 = Math.min(...closes);
    const pct52w = ((price - lo52) / (hi52 - lo52)) * 100; // 0..100 position in range
    const relVol = volAvg20[n] ? vols[n] / volAvg20[n] : 1;

    // crossover detections (last bar)
    const macdCrossUp = mac.line[n] > mac.signal[n] && mac.line[n - 1] <= mac.signal[n - 1];
    const macdCrossDown = mac.line[n] < mac.signal[n] && mac.line[n - 1] >= mac.signal[n - 1];
    const goldenCross = ema50[n] > ema200[n] && ema50[n - 5] <= ema200[n - 5];
    const deathCross = ema50[n] < ema200[n] && ema50[n - 5] >= ema200[n - 5];
    const stochCrossUp = sr.k[n] > sr.d[n] && sr.k[n - 1] <= sr.d[n - 1];

    // per-bar snapshot for historical marker evaluation
    const snap = (i) => ({
      price: closes[i],
      emas: Object.keys(emaCache).reduce((o, w) => { o[w] = emaCache[w][i]; return o; }, {}),
      rsi: rsiArr[i],
      macdHist: mac.hist[i],
      macdLine: mac.line[i],
      macdSignal: mac.signal[i],
      stochK: sr.k[i] ?? 50,
      stochD: sr.d[i] ?? 50,
      relVol: volAvg20[i] ? vols[i] / volAvg20[i] : 1,
      pPriceEma20: ema20[i] ? pct(closes[i], ema20[i]) : 0,
      pPriceEma50: ema50[i] ? pct(closes[i], ema50[i]) : 0,
      pPriceEma200: ema200[i] ? pct(closes[i], ema200[i]) : 0,
      ema20Above50: ema20[i] > ema50[i],
      ema50Above200: ema50[i] > ema200[i],
      macdCrossUp: i > 0 && mac.line[i] > mac.signal[i] && mac.line[i - 1] <= mac.signal[i - 1],
      stochCrossUp: i > 0 && (sr.k[i] ?? 0) > (sr.d[i] ?? 0) && (sr.k[i - 1] ?? 0) <= (sr.d[i - 1] ?? 0),
    });

    const latest = snap(n);

    const stockObj = {
      ticker, name, sector,
      price, changePct, pct52w, relVol, hi52, lo52,
      rsi: rsiArr[n], macdHist: mac.hist[n], macdLine: mac.line[n], macdSignal: mac.signal[n],
      stochK: sr.k[n] ?? 50, stochD: sr.d[n] ?? 50,
      ema9: ema9[n], ema20: ema20[n], ema50: ema50[n], ema200: ema200[n],
      macdCrossUp, macdCrossDown, goldenCross, deathCross, stochCrossUp,
      latest,
      sparkline: closes.slice(-40),
      // full arrays sliced to visible window for the detail chart
      series: bars.slice(-VISIBLE),
      ind: {
        ema9: ema9.slice(-VISIBLE),
        ema20: ema20.slice(-VISIBLE),
        ema50: ema50.slice(-VISIBLE),
        ema200: ema200.slice(-VISIBLE),
        rsi: rsiArr.slice(-VISIBLE),
        stochK: sr.k.slice(-VISIBLE),
        stochD: sr.d.slice(-VISIBLE),
        macdLine: mac.line.slice(-VISIBLE),
        macdSignal: mac.signal.slice(-VISIBLE),
        macdHist: mac.hist.slice(-VISIBLE),
        volAvg20: volAvg20.slice(-VISIBLE),
      },
      snapAt: (i) => snap(closes.length - VISIBLE + i), // map visible idx -> snapshot
      snapAbs: snap,                                    // snapshot at any absolute bar index
      full: { o: bars.map(b => b.o), h: bars.map(b => b.h), l: bars.map(b => b.l), c: closes.slice(), v: vols },
      nLast: closes.length - 1,
      visStart: closes.length - VISIBLE,
      indExtra,
    };
    // compute & cache an EMA for an arbitrary window across the full history
    stockObj.ensureEma = (w) => {
      w = +w;
      if (!emaCache[w]) emaCache[w] = ema(closes, w);
      if (!indExtra[w]) indExtra[w] = emaCache[w].slice(-VISIBLE);
      stockObj.latest = snap(closes.length - 1);
    };
    return stockObj;
  });
  return stocks;
}

// add a custom EMA window to every stock so it can be used in rules + drawn
export function addEmaWindow(stocks, win) {
  win = +win;
  if (!win || win < 2 || win > 600) return false;
  for (const s of stocks) s.ensureEma(win);
  return true;
}

// ---------- rule engine ----------
// field definitions used by both presets and custom rules
export const FIELDS = {
  rsi:        { label: 'RSI (14)',          fmt: v => v.toFixed(1),  min: 0,   max: 100, step: 1,   unit: '' },
  stochK:     { label: 'Stoch RSI %K',      fmt: v => v.toFixed(1),  min: 0,   max: 100, step: 1,   unit: '' },
  macdHist:   { label: 'MACD histogram',    fmt: v => v.toFixed(3),  min: -5,  max: 5,   step: 0.1, unit: '' },
  relVol:     { label: 'Relative volume',   fmt: v => v.toFixed(2) + '×', min: 0, max: 5, step: 0.1, unit: '×' },
  changePct:  { label: 'Change today',      fmt: v => v.toFixed(2) + '%', min: -10, max: 10, step: 0.5, unit: '%' },
  pPriceEma20:{ label: 'Price vs EMA20',    fmt: v => v.toFixed(1) + '%', min: -15, max: 15, step: 0.5, unit: '%' },
  pPriceEma50:{ label: 'Price vs EMA50',    fmt: v => v.toFixed(1) + '%', min: -25, max: 25, step: 0.5, unit: '%' },
  pPriceEma200:{label: 'Price vs EMA200',   fmt: v => v.toFixed(1) + '%', min: -40, max: 40, step: 1,   unit: '%' },
  pct52w:     { label: '52w range position',fmt: v => v.toFixed(0) + '%', min: 0,  max: 100, step: 5,  unit: '%' },
};

// boolean signal flags
export const FLAGS = {
  ema20Above50:  'EMA20 > EMA50',
  ema50Above200: 'EMA50 > EMA200 (uptrend)',
  macdCrossUp:   'MACD bullish cross',
  stochCrossUp:  'Stoch RSI bullish cross',
};

function getField(snap, field) {
  switch (field) {
    case 'changePct': return snap.changePct ?? 0;
    case 'pct52w': return snap.pct52w ?? 50;
    default: return snap[field];
  }
}

// evaluate one rule against a snapshot
export function evalRule(snap, rule) {
  if (rule.kind === 'flag') return !!snap[rule.field];
  if (rule.kind === 'ema') {
    const left = snap.emas ? snap.emas[rule.win] : null;
    const right = rule.target === 'price' ? snap.price : (snap.emas ? snap.emas[rule.targetWin] : null);
    if (left == null || right == null) return false;
    return rule.op === 'gt' ? left > right : left < right;
  }
  const v = getField(snap, rule.field);
  if (v == null || isNaN(v)) return false;
  if (rule.op === 'gt') return v > rule.value;
  if (rule.op === 'lt') return v < rule.value;
  if (rule.op === 'between') return v >= rule.min && v <= rule.max;
  return false;
}

export function evalRules(snap, rules) {
  if (!rules.length) return true;
  return rules.every(r => evalRule(snap, r));
}

// ---- atomic rule builders --------------------------------------------------
// Small helpers used to compose the TC2000 strategies out of the same atomic
// primitives a user builds custom screens with: condition-group operands
// (price/volume fields & indicators, with bar offsets) and chain comparisons.
const _f   = (field, offset = 0) => ({ kind: 'field', field, offset });            // O/H/L/C/V, n bars ago
const _ema = (length) => ({ kind: 'ind', def: { type: 'ema', source: 'close', length } });
const _smaV = (length) => ({ kind: 'ind', def: { type: 'sma', source: 'volume', length } });
const _k   = (value) => ({ kind: 'const', value });                                 // constant
const _c   = (left, op, right) => ({ left, op, right });                            // one group condition
const _xema = (length) => ({ type: 'ind', def: { type: 'ema', source: 'close', length } }); // chain operand

// preset strategies — bundles of rules
export const PRESETS = [
  {
    id: 'all', name: 'All stocks', desc: 'No filters applied — full universe.',
    rules: [],
  },
  {
    id: 'oversold', name: 'Oversold in uptrend', desc: 'RSI < 35 while price holds above EMA200. Classic pullback-buy setup.',
    rules: [
      { kind: 'num', field: 'rsi', op: 'lt', value: 38 },
      { kind: 'flag', field: 'ema50Above200' },
    ],
  },
  {
    id: 'macdmomo', name: 'MACD momentum', desc: 'Positive MACD histogram with bullish EMA stack. Trend continuation.',
    rules: [
      { kind: 'num', field: 'macdHist', op: 'gt', value: 0 },
      { kind: 'flag', field: 'ema20Above50' },
      { kind: 'flag', field: 'ema50Above200' },
    ],
  },
  {
    id: 'macdcross', name: 'Fresh MACD cross', desc: 'MACD line just crossed above signal — early momentum trigger.',
    rules: [
      { kind: 'flag', field: 'macdCrossUp' },
    ],
  },
  {
    id: 'volbreak', name: 'Volume breakout', desc: 'Relative volume > 1.8× while price extends above EMA20.',
    rules: [
      { kind: 'num', field: 'relVol', op: 'gt', value: 1.8 },
      { kind: 'num', field: 'pPriceEma20', op: 'gt', value: 1 },
    ],
  },
  {
    id: 'stochturn', name: 'Stoch RSI oversold turn', desc: 'Stoch RSI below 25 turning up — reversal entry.',
    rules: [
      { kind: 'num', field: 'stochK', op: 'lt', value: 30 },
      { kind: 'flag', field: 'stochCrossUp' },
    ],
  },
  {
    id: 'pullback', name: 'Trend pullback', desc: 'Uptrend with price 0–6% below EMA20 — buy the dip.',
    rules: [
      { kind: 'flag', field: 'ema50Above200' },
      { kind: 'num', field: 'pPriceEma20', op: 'between', min: -6, max: 0 },
    ],
  },
  {
    id: 'tc_bounce_long', name: 'TC2000 · EMA bounce (long)', desc: 'Wick tags the rising 50-EMA but opens & closes back above it, in a stacked uptrend (18>50>100>200).',
    rules: [
      { kind: 'chain', name: 'EMAs stacked up · 18 > 50 > 100 > 200', operands: [_xema(18), _xema(50), _xema(100), _xema(200)], ops: ['gt', 'gt', 'gt'] },
      { kind: 'group', name: 'Wick tags the rising 50-EMA', conds: [_c(_f('low'), 'lt', _ema(50)), _c(_f('low'), 'lt', _f('low', 1))] },
      { kind: 'group', name: 'Opens & closes back above 50-EMA', conds: [_c(_f('open'), 'gt', _ema(50)), _c(_f('close'), 'gt', _ema(50)), _c(_f('open'), 'gt', _f('low', 1)), _c(_f('close'), 'gt', _f('low', 1))] },
    ],
  },
  {
    id: 'tc_bounce_short', name: 'TC2000 · EMA bounce (short)', desc: 'Wick tags the falling 50-EMA but opens & closes back below it, in a stacked downtrend (18<50<100<200).',
    rules: [
      { kind: 'chain', name: 'EMAs stacked down · 18 < 50 < 100 < 200', operands: [_xema(18), _xema(50), _xema(100), _xema(200)], ops: ['lt', 'lt', 'lt'] },
      { kind: 'group', name: 'Wick tags the falling 50-EMA', conds: [_c(_f('high'), 'gt', _ema(50)), _c(_f('high'), 'gt', _f('high', 1))] },
      { kind: 'group', name: 'Opens & closes back below 50-EMA', conds: [_c(_f('open'), 'lt', _ema(50)), _c(_f('close'), 'lt', _ema(50)), _c(_f('open'), 'lt', _f('high', 1)), _c(_f('close'), 'lt', _f('high', 1))] },
    ],
  },
  {
    id: 'tc_reversal_long', name: 'TC2000 · Reversal bar (long)', desc: 'Lower high, green body today, green body prior — the GREEN-RED reversal candle.',
    rules: [
      { kind: 'group', name: 'Green reversal bar under a lower high', conds: [_c(_f('high'), 'lt', _f('high', 1)), _c(_f('close'), 'gt', _f('open')), _c(_f('open', 1), 'lt', _f('close', 1))] },
    ],
  },
  {
    id: 'tc_reversal_short', name: 'TC2000 · Reversal bar (short)', desc: 'Higher low, red body today, red body prior — the RED-GREEN reversal candle.',
    rules: [
      { kind: 'group', name: 'Red reversal bar over a higher low', conds: [_c(_f('low'), 'gt', _f('low', 1)), _c(_f('close'), 'lt', _f('open')), _c(_f('open', 1), 'gt', _f('close', 1))] },
    ],
  },
  {
    id: 'tc_cont_long', name: 'TC2000 · Continuation (long)', desc: '18-EMA crosses up through the 50-EMA with 50>100>200 stacked up and avg volume > 250k.',
    rules: [
      { kind: 'group', name: '18-EMA crosses up through 50-EMA', conds: [_c(_ema(18), 'cross_up', _ema(50))] },
      { kind: 'chain', name: 'EMAs stacked up · 50 > 100 > 200', operands: [_xema(50), _xema(100), _xema(200)], ops: ['gt', 'gt'] },
      { kind: 'group', name: 'Avg volume (60) above 250k', conds: [_c(_smaV(60), 'gt', _k(250000))] },
    ],
  },
  {
    id: 'tc_cont_short', name: 'TC2000 · Continuation (short)', desc: '18-EMA crosses down through the 50-EMA with 50<100<200 stacked down and avg volume > 250k.',
    rules: [
      { kind: 'group', name: '18-EMA crosses down through 50-EMA', conds: [_c(_ema(18), 'cross_down', _ema(50))] },
      { kind: 'chain', name: 'EMAs stacked down · 50 < 100 < 200', operands: [_xema(50), _xema(100), _xema(200)], ops: ['lt', 'lt'] },
      { kind: 'group', name: 'Avg volume (60) above 250k', conds: [_c(_smaV(60), 'gt', _k(250000))] },
    ],
  },
];

// ============================================================================
//  CUSTOM INDICATOR ENGINE
//  A "def" is a plain object describing one indicator:
//    { type, source, length, fast, slow, signal, output, rsiLen, stochLen,
//      kSmooth, dSmooth }
//  Only the keys relevant to `type` are read. indSeries() turns a def into a
//  single scalar series computed across a stock's full history (cached).
// ============================================================================

// price/volume sources a user can build an indicator on
export const SOURCES = [
  { value: 'close',  label: 'Close' },
  { value: 'open',   label: 'Open' },
  { value: 'high',   label: 'High' },
  { value: 'low',    label: 'Low' },
  { value: 'hl2',    label: 'Median (H+L)/2' },
  { value: 'hlc3',   label: 'Typical (H+L+C)/3' },
  { value: 'volume', label: 'Volume' },
];

// indicator catalogue + parameter schema used by the builder UI
export const INDICATOR_TYPES = {
  ema: {
    label: 'EMA', tag: 'Exponential moving average', scale: 'price',
    params: [
      { key: 'source', kind: 'source', label: 'Source' },
      { key: 'length', kind: 'int', label: 'Length', min: 2, max: 400 },
    ],
  },
  sma: {
    label: 'SMA', tag: 'Simple moving average', scale: 'price',
    params: [
      { key: 'source', kind: 'source', label: 'Source' },
      { key: 'length', kind: 'int', label: 'Length', min: 2, max: 400 },
    ],
  },
  rsi: {
    label: 'RSI', tag: 'Relative strength index', scale: 'osc', range: [0, 100],
    params: [
      { key: 'source', kind: 'source', label: 'Source' },
      { key: 'length', kind: 'int', label: 'Length', min: 2, max: 100 },
    ],
  },
  macd: {
    label: 'MACD', tag: 'Moving avg convergence/divergence', scale: 'center',
    params: [
      { key: 'source', kind: 'source', label: 'Source' },
      { key: 'fast', kind: 'int', label: 'Fast', min: 2, max: 100 },
      { key: 'slow', kind: 'int', label: 'Slow', min: 3, max: 300 },
      { key: 'signal', kind: 'int', label: 'Signal', min: 1, max: 100 },
      { key: 'output', kind: 'enum', label: 'Output', options: [
        { value: 'line', label: 'MACD line' }, { value: 'signal', label: 'Signal line' }, { value: 'hist', label: 'Histogram' } ] },
    ],
  },
  stochrsi: {
    label: 'Stoch RSI', tag: 'Stochastic RSI', scale: 'osc', range: [0, 100],
    params: [
      { key: 'source', kind: 'source', label: 'Source' },
      { key: 'rsiLen', kind: 'int', label: 'RSI length', min: 2, max: 100 },
      { key: 'stochLen', kind: 'int', label: 'Stoch length', min: 2, max: 100 },
      { key: 'kSmooth', kind: 'int', label: '%K smooth', min: 1, max: 20 },
      { key: 'dSmooth', kind: 'int', label: '%D smooth', min: 1, max: 20 },
      { key: 'output', kind: 'enum', label: 'Output', options: [
        { value: 'k', label: '%K' }, { value: 'd', label: '%D' } ] },
    ],
  },
  price: {
    label: 'Price', tag: 'Raw price / volume series', scale: 'price',
    params: [
      { key: 'source', kind: 'source', label: 'Source' },
    ],
  },
};

// defaults for a freshly chosen indicator type
export const IND_DEFAULTS = {
  ema:      { source: 'close', length: 21 },
  sma:      { source: 'close', length: 50 },
  rsi:      { source: 'close', length: 14 },
  macd:     { source: 'close', fast: 12, slow: 26, signal: 9, output: 'line' },
  stochrsi: { source: 'close', rsiLen: 14, stochLen: 14, kSmooth: 3, dSmooth: 3, output: 'k' },
  price:    { source: 'close' },
};

export function newDef(type) {
  return { type, ...(IND_DEFAULTS[type] || {}) };
}

// generalized MACD with configurable periods
export function macdFull(values, fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => ef[i] - es[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, hist };
}

function srcArr(stock, source) {
  const f = stock.full;
  switch (source) {
    case 'open':   return f.o;
    case 'high':   return f.h;
    case 'low':    return f.l;
    case 'volume': return f.v;
    case 'hl2':    return f.c.map((_, i) => (f.h[i] + f.l[i]) / 2);
    case 'hlc3':   return f.c.map((_, i) => (f.h[i] + f.l[i] + f.c[i]) / 3);
    case 'close':
    default:       return f.c;
  }
}

export function defSig(d) {
  return [d.type, d.source, d.length, d.fast, d.slow, d.signal, d.output, d.rsiLen, d.stochLen, d.kSmooth, d.dSmooth].join('|');
}

// compute (and cache) a def's scalar series across the stock's full history
export function indSeries(stock, def) {
  const sig = defSig(def);
  stock._indCache = stock._indCache || {};
  if (stock._indCache[sig]) return stock._indCache[sig];
  const src = srcArr(stock, def.source || 'close');
  let series;
  switch (def.type) {
    case 'ema': series = ema(src, +def.length); break;
    case 'sma': series = sma(src, +def.length); break;
    case 'rsi': series = rsi(src, +def.length); break;
    case 'macd': {
      const m = macdFull(src, +def.fast, +def.slow, +def.signal);
      series = def.output === 'signal' ? m.signal : def.output === 'hist' ? m.hist : m.line;
      break;
    }
    case 'stochrsi': {
      const r = rsi(src, +def.rsiLen);
      const sr = stochRsi(r, +def.stochLen, +def.kSmooth, +def.dSmooth);
      series = def.output === 'd' ? sr.d : sr.k;
      break;
    }
    case 'price':
    default: series = src.slice(); break;
  }
  stock._indCache[sig] = series;
  return series;
}

// is this indicator drawn on the price axis (overlay) vs its own oscillator pane?
export function isPriceScale(def) {
  if (!def) return false;
  if (def.type === 'price') return def.source !== 'volume';
  return def.type === 'ema' || def.type === 'sma';
}

// human label for a def
export function autoIndName(d) {
  const src = d.source && d.source !== 'close' ? ' ' + (d.source === 'hl2' ? 'HL2' : d.source === 'hlc3' ? 'HLC3' : d.source[0].toUpperCase() + d.source.slice(1)) : '';
  switch (d.type) {
    case 'ema': return `EMA ${d.length}${src}`;
    case 'sma': return `SMA ${d.length}${src}`;
    case 'rsi': return `RSI ${d.length}${src}`;
    case 'macd': return `MACD ${d.fast}/${d.slow}/${d.signal} ${d.output === 'signal' ? 'sig' : d.output}`;
    case 'stochrsi': return `Stoch RSI ${d.output === 'd' ? '%D' : '%K'} ${d.rsiLen}`;
    case 'price': return d.source && d.source !== 'close' ? src.trim() : 'Price';
    default: return d.type;
  }
}

export const OP_LABELS = {
  gt: 'is above', lt: 'is below',
  cross_up: 'crosses above', cross_down: 'crosses below',
  between: 'is between', rising: 'is rising', falling: 'is falling',
};
const OP_SYM = { gt: '>', lt: '<', cross_up: '⤴', cross_down: '⤵' };

// short chip label for an indicator rule
export function indRuleLabel(r) {
  const ln = r.left.name || autoIndName(r.left);
  if (r.op === 'rising') return `${ln} rising`;
  if (r.op === 'falling') return `${ln} falling`;
  if (r.op === 'between') return `${ln} ∈ ${r.min}–${r.max}`;
  const rn = r.rhs.type === 'const' ? r.rhs.value : r.rhs.type === 'price' ? 'Price' : (r.rhs.def.name || autoIndName(r.rhs.def));
  return `${ln} ${OP_SYM[r.op] || OP_LABELS[r.op]} ${rn}`;
}

// evaluate one indicator rule at absolute bar index i
export function evalIndRuleAt(stock, rule, i) {
  const L = indSeries(stock, rule.left);
  const lv = L[i];
  if (lv == null || isNaN(lv)) return false;
  if (rule.op === 'between') return lv >= rule.min && lv <= rule.max;
  if (rule.op === 'rising')  return i > 0 && L[i - 1] != null && lv > L[i - 1];
  if (rule.op === 'falling') return i > 0 && L[i - 1] != null && lv < L[i - 1];
  const rhsAt = (j) => {
    if (!rule.rhs) return null;
    if (rule.rhs.type === 'const') return +rule.rhs.value;
    if (rule.rhs.type === 'price') return stock.full.c[j];
    return indSeries(stock, rule.rhs.def)[j];
  };
  const rv = rhsAt(i);
  if (rv == null || isNaN(rv)) return false;
  if (rule.op === 'gt') return lv > rv;
  if (rule.op === 'lt') return lv < rv;
  if (rule.op === 'cross_up' || rule.op === 'cross_down') {
    if (i < 1) return false;
    const pl = L[i - 1], pr = rhsAt(i - 1);
    if (pl == null || pr == null) return false;
    return rule.op === 'cross_up' ? (pl <= pr && lv > rv) : (pl >= pr && lv < rv);
  }
  return false;
}

// ---- chained comparisons (named "screens") ------------------------------
// A chain rule: { kind:'chain', operands:[op,...], ops:['gt'|'lt', ...], name }
// where ops[k] compares operand[k] vs operand[k+1]. An operand is one of:
//   { type:'ind', def }  |  { type:'price' }  |  { type:'const', value }
export function chainOperandVal(stock, op, i) {
  if (!op) return null;
  if (op.type === 'const') return +op.value;
  if (op.type === 'price') return stock.full.c[i];
  return indSeries(stock, op.def)[i];
}

export function evalChainAt(stock, rule, i) {
  const ops = rule.operands || [];
  if (ops.length < 2) return false;
  for (let k = 0; k < ops.length - 1; k++) {
    const a = chainOperandVal(stock, ops[k], i);
    const b = chainOperandVal(stock, ops[k + 1], i);
    if (a == null || b == null || isNaN(a) || isNaN(b)) return false;
    const o = rule.ops[k];
    if (o === 'gt' && !(a > b)) return false;
    if (o === 'lt' && !(a < b)) return false;
  }
  return true;
}

export function chainLabel(rule) {
  const nm = (op) => op.type === 'const' ? op.value : op.type === 'price' ? 'Price' : (op.def.name || autoIndName(op.def));
  let s = nm(rule.operands[0]);
  for (let k = 0; k < rule.ops.length; k++) s += ` ${rule.ops[k] === 'gt' ? '>' : '<'} ${nm(rule.operands[k + 1])}`;
  return s;
}

// ---- condition groups ("setups") ----------------------------------------
// A general AND/OR group of pairwise comparisons, each operand carrying a
// bar OFFSET (0 = current bar, 1 = one bar ago, like TC2000's `.1` suffix).
//   { kind:'group', conds:[cond,...], name }
//   cond = { left:operand, op, right:operand, conj:'and'|'or' }
//   operand = { kind:'field', field, offset } | { kind:'ind', def, offset } | { kind:'const', value }
// `field` is any price/volume source (close/open/high/low/hl2/hlc3/volume).
export const OPERAND_FIELDS = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'hl2', label: 'Median (H+L)/2' },
  { value: 'hlc3', label: 'Typical (H+L+C)/3' },
  { value: 'volume', label: 'Volume' },
];
const FIELD_LABEL = { close: 'Close', open: 'Open', high: 'High', low: 'Low', hl2: 'HL2', hlc3: 'HLC3', volume: 'Volume' };
export const GROUP_OPS = [
  { value: 'gt', label: '>' }, { value: 'lt', label: '<' },
  { value: 'gte', label: '≥' }, { value: 'lte', label: '≤' },
  { value: 'cross_up', label: 'crosses ↑' }, { value: 'cross_down', label: 'crosses ↓' },
  { value: 'eq', label: '≈' },
];
const GROUP_OP_SYM = { gt: '>', lt: '<', gte: '≥', lte: '≤', cross_up: '⤴', cross_down: '⤵', eq: '≈' };

export function groupOperandVal(stock, op, i) {
  if (!op) return null;
  if (op.kind === 'const') return +op.value;
  const j = i - (op.offset || 0);
  if (j < 0) return null;
  let base = null;
  if (op.kind === 'field') { const a = srcArr(stock, op.field); base = a ? a[j] : null; }
  else if (op.kind === 'ind') { const s = indSeries(stock, op.def); base = s ? s[j] : null; }
  if (base == null || isNaN(base)) return base;
  const mult = (op.mult == null || op.mult === '') ? 1 : +op.mult;
  const add = (op.add == null || op.add === '') ? 0 : +op.add;
  return base * (isNaN(mult) ? 1 : mult) + (isNaN(add) ? 0 : add);
}

export function evalCondAt(stock, c, i) {
  if (!c) return false;
  const a = groupOperandVal(stock, c.left, i), b = groupOperandVal(stock, c.right, i);
  if (c.op === 'cross_up' || c.op === 'cross_down') {
    const pa = groupOperandVal(stock, c.left, i - 1), pb = groupOperandVal(stock, c.right, i - 1);
    if ([a, b, pa, pb].some(v => v == null || isNaN(v))) return false;
    return c.op === 'cross_up' ? (pa <= pb && a > b) : (pa >= pb && a < b);
  }
  if (a == null || b == null || isNaN(a) || isNaN(b)) return false;
  switch (c.op) {
    case 'gt': return a > b;
    case 'lt': return a < b;
    case 'gte': return a >= b;
    case 'lte': return a <= b;
    case 'eq': return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.0015);
    default: return false;
  }
}

// AND/OR grouping mirrors evalGroupedRules: consecutive 'or' conds form an
// OR-group; groups are AND'd together.
export function evalGroupAt(stock, rule, i) {
  const conds = rule.conds || [];
  if (!conds.length) return true;
  const groups = []; let cur = [conds[0]];
  for (let k = 1; k < conds.length; k++) {
    if (conds[k] && conds[k].conj === 'or') cur.push(conds[k]);
    else { groups.push(cur); cur = [conds[k]]; }
  }
  groups.push(cur);
  return groups.every(g => g.some(c => evalCondAt(stock, c, i)));
}

export function operandLabel(op) {
  if (!op) return '?';
  if (op.kind === 'const') return String(op.value);
  let s = op.kind === 'field' ? (FIELD_LABEL[op.field] || op.field) : (op.def.name || autoIndName(op.def));
  if ((op.offset || 0) > 0) s += `[t−${op.offset}]`;
  const mult = (op.mult == null || op.mult === '') ? 1 : +op.mult;
  const add = (op.add == null || op.add === '') ? 0 : +op.add;
  if (!isNaN(mult) && mult !== 1) s += `×${mult}`;
  if (!isNaN(add) && add !== 0) s += (add > 0 ? `+${add}` : `${add}`);
  return s;
}

export function groupLabel(rule) {
  return (rule.conds || []).map((c, k) =>
    `${k > 0 ? (c.conj === 'or' ? ' OR ' : ' AND ') : ''}${operandLabel(c.left)} ${GROUP_OP_SYM[c.op] || c.op} ${operandLabel(c.right)}`
  ).join('');
}

// ---- TC2000 PCF text parser ---------------------------------------------
// Turns pasted TC2000 "Personal Criteria Formula" text into a condition group.
// Understands:
//   O H L C V                price/volume of the current bar (O1, C2 = bars ago)
//   XAVGC<n> / XAVGO<n>…     exponential MA of close/open/…, .<k> = bars ago
//   AVGC<n> / AVGV<n>…       simple MA, .<k> = bars ago
//   numbers                  constants
//   * /  and  + -            per-operand arithmetic (e.g. XAVGC50*1.02)
//   > < >= <= =              comparisons,  AND / OR  between them
const PCF_SRC = { C: 'close', O: 'open', H: 'high', L: 'low', V: 'volume' };

function parsePcfBase(base) {
  if (/^[\d.]+$/.test(base)) return { kind: 'const', value: +base };
  let offset = 0, core = base;
  const dot = base.match(/^(.*?)\.(\d+)$/);
  if (dot) { core = dot[1]; offset = +dot[2]; }
  let m;
  if ((m = core.match(/^XAVG([COHLV])(\d+)$/))) return { kind: 'ind', def: { type: 'ema', source: PCF_SRC[m[1]], length: +m[2] }, offset };
  if ((m = core.match(/^AVG([COHLV])(\d+)$/))) return { kind: 'ind', def: { type: 'sma', source: PCF_SRC[m[1]], length: +m[2] }, offset };
  if ((m = core.match(/^([OHLCV])(\d*)$/))) return { kind: 'field', field: PCF_SRC[m[1]], offset: m[2] ? +m[2] : offset };
  return null;
}

function parsePcfOperand(raw) {
  const t = (raw || '').replace(/\s+/g, '');
  if (!t) return null;
  const m = t.match(/^([A-Z][A-Z0-9.]*|[\d.]+)(?:([*\/])([\d.]+))?(?:([+\-])([\d.]+))?$/);
  if (!m) return null;
  const parsed = parsePcfBase(m[1]);
  if (!parsed) return null;
  let mult = 1, add = 0;
  if (m[2]) { const k = +m[3]; mult = m[2] === '/' ? (k ? 1 / k : 1) : k; }
  if (m[4]) { add = (m[4] === '-' ? -1 : 1) * +m[5]; }
  if (parsed.kind === 'const') return parsed;
  return { ...parsed, mult, add };
}

export function parsePCF(text) {
  if (!text || !text.trim()) return { error: 'Paste a formula first.' };
  let s = ' ' + text.toUpperCase().replace(/\bPCF\b/g, ' ').replace(/[\r\n\t]+/g, ' ') + ' ';
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\b(AND|OR)\b\s*$/i, '').trim();
  s = s.replace(/^\(\s*|\s*\)$/g, '').trim();
  const parts = s.split(/\b(AND|OR)\b/);
  const OPMAP = { '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte', '=': 'eq', '<>': 'lt' };
  const conds = [];
  let pendingConj = 'and';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (!p) continue;
    if (p === 'AND' || p === 'OR') { pendingConj = p.toLowerCase(); continue; }
    const body = p.replace(/^\(+|\)+$/g, '').trim();
    const cm = body.match(/^(.+?)(>=|<=|<>|>|<|=)(.+)$/);
    if (!cm) return { error: `Couldn’t read “${body}” — expected something like  C > XAVGC50` };
    const left = parsePcfOperand(cm[1]), right = parsePcfOperand(cm[3]);
    if (!left) return { error: `Unknown term “${cm[1].trim()}”` };
    if (!right) return { error: `Unknown term “${cm[3].trim()}”` };
    conds.push({ left, op: OPMAP[cm[2]], right, conj: conds.length === 0 ? 'and' : pendingConj });
    pendingConj = 'and';
  }
  if (!conds.length) return { error: 'No conditions found.' };
  return { rule: { kind: 'group', conds } };
}

// ---- price-action patterns ----------------------------------------------
// Boolean, multi-bar candle/structure signals. A pattern rule:
//   { kind:'pattern', pat:'consec_down', n:3, name }
// evaluated at absolute bar index i against the stock's OHLC.
export const PATTERNS = {
  consec_down:   { label: 'down bars in a row', desc: 'Open AND close both below the prior bar, N bars running.', count: true, n: 3, min: 2, max: 12, countLabel: 'Bars in a row' },
  consec_up:     { label: 'up bars in a row', desc: 'Open AND close both above the prior bar, N bars running.', count: true, n: 3, min: 2, max: 12, countLabel: 'Bars in a row' },
  lower_closes:  { label: 'lower closes in a row', desc: 'Each close below the previous close, N bars running.', count: true, n: 3, min: 2, max: 12, countLabel: 'Bars in a row' },
  higher_closes: { label: 'higher closes in a row', desc: 'Each close above the previous close, N bars running.', count: true, n: 3, min: 2, max: 12, countLabel: 'Bars in a row' },
  higher_hl:     { label: 'higher highs & lows', desc: 'N bars each printing a higher high and a higher low (uptrend structure).', count: true, n: 3, min: 2, max: 10, countLabel: 'Bars in a row' },
  lower_hl:      { label: 'lower highs & lows', desc: 'N bars each printing a lower high and a lower low (downtrend structure).', count: true, n: 3, min: 2, max: 10, countLabel: 'Bars in a row' },
  inside_bar:    { label: 'Inside bar', desc: "Today's range sits entirely within the prior bar's range — consolidation." },
  outside_bar:   { label: 'Outside bar', desc: "Today's range engulfs the prior bar's high and low — volatility expansion." },
  bull_engulf:   { label: 'Bullish engulfing', desc: "A green bar whose body engulfs the prior red body." },
  bear_engulf:   { label: 'Bearish engulfing', desc: "A red bar whose body engulfs the prior green body." },
  gap_up:        { label: 'Gap up', desc: 'Opens above the prior bar high.' },
  gap_down:      { label: 'Gap down', desc: 'Opens below the prior bar low.' },
  new_high:      { label: 'N-bar high breakout', desc: 'Close is the highest of the last N bars.', count: true, n: 20, min: 3, max: 120, countLabel: 'Lookback bars' },
  new_low:       { label: 'N-bar low breakdown', desc: 'Close is the lowest of the last N bars.', count: true, n: 20, min: 3, max: 120, countLabel: 'Lookback bars' },
  bull_div:      { label: 'Bullish RSI divergence', desc: 'Price prints a lower low while RSI prints a higher low across the lookback — fading downside momentum.', count: true, n: 24, min: 10, max: 60, countLabel: 'Lookback bars' },
  bear_div:      { label: 'Bearish RSI divergence', desc: 'Price prints a higher high while RSI prints a lower high across the lookback — fading upside momentum.', count: true, n: 24, min: 10, max: 60, countLabel: 'Lookback bars' },
  doji:          { label: 'Doji', desc: 'Open and close nearly equal — indecision candle.' },
};

function ensureRsiBT(stock) { if (!stock._rsiBT) stock._rsiBT = rsi(stock.full.c, 14); return stock._rsiBT; }

// cached close-EMA / volume-SMA across full history, for PCF-style setups
function pcfEma(stock, w) { stock._pcfEma = stock._pcfEma || {}; if (!stock._pcfEma[w]) stock._pcfEma[w] = ema(stock.full.c, w); return stock._pcfEma[w]; }
function pcfAvgVol(stock, w) { stock._pcfAvgv = stock._pcfAvgv || {}; if (!stock._pcfAvgv[w]) stock._pcfAvgv[w] = sma(stock.full.v, w); return stock._pcfAvgv[w]; }

export function evalPatternAt(stock, rule, i) {
  const f = stock.full, o = f.o, h = f.h, l = f.l, c = f.c;
  const n = +rule.n || 3;
  const downBar = (j) => j > 0 && o[j] < o[j - 1] && c[j] < c[j - 1];
  const upBar = (j) => j > 0 && o[j] > o[j - 1] && c[j] > c[j - 1];
  switch (rule.pat) {
    case 'consec_down':   { if (i < n) return false; for (let k = 0; k < n; k++) if (!downBar(i - k)) return false; return true; }
    case 'consec_up':     { if (i < n) return false; for (let k = 0; k < n; k++) if (!upBar(i - k)) return false; return true; }
    case 'lower_closes':  { if (i < n) return false; for (let k = 0; k < n; k++) if (!(c[i - k] < c[i - k - 1])) return false; return true; }
    case 'higher_closes': { if (i < n) return false; for (let k = 0; k < n; k++) if (!(c[i - k] > c[i - k - 1])) return false; return true; }
    case 'higher_hl':     { if (i < n) return false; for (let k = 0; k < n; k++) { const j = i - k; if (!(h[j] > h[j - 1] && l[j] > l[j - 1])) return false; } return true; }
    case 'lower_hl':      { if (i < n) return false; for (let k = 0; k < n; k++) { const j = i - k; if (!(h[j] < h[j - 1] && l[j] < l[j - 1])) return false; } return true; }
    case 'inside_bar':    return i > 0 && h[i] < h[i - 1] && l[i] > l[i - 1];
    case 'outside_bar':   return i > 0 && h[i] > h[i - 1] && l[i] < l[i - 1];
    case 'bull_engulf':   return i > 0 && c[i - 1] < o[i - 1] && c[i] > o[i] && c[i] >= o[i - 1] && o[i] <= c[i - 1];
    case 'bear_engulf':   return i > 0 && c[i - 1] > o[i - 1] && c[i] < o[i] && o[i] >= c[i - 1] && c[i] <= o[i - 1];
    case 'gap_up':        return i > 0 && o[i] > h[i - 1];
    case 'gap_down':      return i > 0 && o[i] < l[i - 1];
    case 'new_high':      { if (i < n) return false; let mx = -Infinity; for (let k = 1; k <= n; k++) mx = Math.max(mx, c[i - k]); return c[i] > mx; }
    case 'new_low':       { if (i < n) return false; let mn = Infinity; for (let k = 1; k <= n; k++) mn = Math.min(mn, c[i - k]); return c[i] < mn; }
    case 'bull_div': {
      if (i < n) return false;
      const R = ensureRsiBT(stock), half = Math.floor(n / 2);
      let rIdx = -1, rLow = Infinity; for (let j = i - half; j <= i; j++) { if (c[j] < rLow) { rLow = c[j]; rIdx = j; } }
      let eIdx = -1, eLow = Infinity; for (let j = i - n; j < i - half; j++) { if (c[j] < eLow) { eLow = c[j]; eIdx = j; } }
      if (rIdx < 0 || eIdx < 0) return false;
      return c[rIdx] < c[eIdx] && R[rIdx] > R[eIdx] && (i - rIdx) <= 2;
    }
    case 'bear_div': {
      if (i < n) return false;
      const R = ensureRsiBT(stock), half = Math.floor(n / 2);
      let rIdx = -1, rHi = -Infinity; for (let j = i - half; j <= i; j++) { if (c[j] > rHi) { rHi = c[j]; rIdx = j; } }
      let eIdx = -1, eHi = -Infinity; for (let j = i - n; j < i - half; j++) { if (c[j] > eHi) { eHi = c[j]; eIdx = j; } }
      if (rIdx < 0 || eIdx < 0) return false;
      return c[rIdx] > c[eIdx] && R[rIdx] < R[eIdx] && (i - rIdx) <= 2;
    }
    case 'doji':          { const rng = h[i] - l[i]; return rng > 0 && Math.abs(c[i] - o[i]) <= 0.1 * rng; }
    default: return false;
  }
}

export function patternLabel(rule) {
  const meta = PATTERNS[rule.pat];
  if (!meta) return rule.pat;
  if (rule.pat === 'new_high') return `New ${rule.n}-bar high`;
  if (rule.pat === 'new_low') return `New ${rule.n}-bar low`;
  if (rule.pat === 'bull_div' || rule.pat === 'bear_div') return meta.label;
  if (meta.count) return `${rule.n}+ ${meta.label}`;
  return meta.label;
}

// unified evaluator: routes indicator/chain/pattern rules to the series engine,
// legacy (num/flag/ema) rules to the per-bar snapshot.
export function evalRuleAt(stock, rule, i) {
  if (rule.kind === 'rank') return true; // cross-sectional — applied separately at the current bar
  if (rule.kind === 'ind') return evalIndRuleAt(stock, rule, i);
  if (rule.kind === 'chain') return evalChainAt(stock, rule, i);
  if (rule.kind === 'group') return evalGroupAt(stock, rule, i);
  if (rule.kind === 'pattern') return evalPatternAt(stock, rule, i);
  return evalRule(stock.snapAbs(i), rule);
}

export function evalRulesOnStock(stock, rules, i) {
  if (!rules || !rules.length) return true;
  const idx = i == null ? stock.nLast : i;
  return rules.every(r => evalRuleAt(stock, r, idx));
}

// ---- grouped AND/OR evaluation ------------------------------------------
// Rules carry an optional `conj` ('and' | 'or') describing how each connects
// to the previous rule. Consecutive 'or' rules form one OR-group; groups are
// AND'd together. A missing conj starts a new (AND) group — so preset rules
// with no conj behave as a pure AND chain.
export function evalGroupedRules(stock, rules, i) {
  if (!rules || !rules.length) return true;
  const idx = i == null ? stock.nLast : i;
  const groups = [];
  let cur = [rules[0]];
  for (let k = 1; k < rules.length; k++) {
    if (rules[k] && rules[k].conj === 'or') cur.push(rules[k]);
    else { groups.push(cur); cur = [rules[k]]; }
  }
  groups.push(cur);
  return groups.every(g => g.some(r => evalRuleAt(stock, r, idx)));
}

// ---- backtest -----------------------------------------------------------
// Walk every bar of every stock; wherever the (grouped) rule set fires, record
// forward returns at each horizon. Returns aggregate hit-rates + return stats.
export function backtestRules(stocks, rules, horizons = [5, 10, 20]) {
  const maxH = Math.max(...horizons), warmup = 30;
  const buckets = {}; horizons.forEach(h => buckets[h] = []);
  let signals = 0, evaluated = 0;
  for (const s of stocks) {
    const c = s.full.c, L = c.length;
    for (let i = warmup; i < L - maxH; i++) {
      evaluated++;
      if (!evalGroupedRules(s, rules, i)) continue;
      signals++;
      for (const h of horizons) buckets[h].push((c[i + h] - c[i]) / c[i] * 100);
    }
  }
  const stat = (arr) => {
    const n = arr.length;
    if (!n) return { n: 0, avg: 0, median: 0, winRate: 0, best: 0, worst: 0 };
    const sorted = arr.slice().sort((a, b) => a - b);
    const avg = arr.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const wins = arr.filter(x => x > 0).length;
    return { n, avg, median, winRate: wins / n * 100, best: sorted[n - 1], worst: sorted[0] };
  };
  return {
    signals, evaluated,
    fireRate: evaluated ? signals / evaluated * 100 : 0,
    horizons: horizons.map(h => ({ h, ...stat(buckets[h]) })),
  };
}

// ---- cross-sectional ranking -------------------------------------------
export const RANK_FIELDS = {
  relVol:    'Relative volume',
  changePct: 'Change today',
  rsi:       'RSI (14)',
  macdHist:  'MACD histogram',
  pct52w:    '52w range position',
  stochK:    'Stoch RSI %K',
};

// Set of tickers that fall in the top/bottom percentile by `field`, optionally
// computed within each sector. Evaluated against the supplied universe at now.
export function rankPassSet(stocks, rule) {
  const field = rule.field, pct = Math.max(1, Math.min(99, +rule.pct || 10)), dir = rule.dir || 'top';
  const groups = new Map();
  if (rule.scope === 'sector') {
    for (const s of stocks) { const g = groups.get(s.sector) || []; g.push(s); groups.set(s.sector, g); }
  } else groups.set('all', stocks.slice());
  const pass = new Set();
  for (const g of groups.values()) {
    const sorted = g.slice().sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0)); // desc
    const k = Math.max(1, Math.ceil(g.length * pct / 100));
    const sel = dir === 'top' ? sorted.slice(0, k) : sorted.slice(Math.max(0, g.length - k));
    sel.forEach(s => pass.add(s.ticker));
  }
  return pass;
}

export function rankLabel(rule) {
  const f = RANK_FIELDS[rule.field] || rule.field;
  return `${rule.dir === 'top' ? 'Top' : 'Bottom'} ${rule.pct}% ${f}${rule.scope === 'sector' ? ' / sector' : ''}`;
}
