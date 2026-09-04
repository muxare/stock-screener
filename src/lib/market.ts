// market.ts — the Stock model and universe build.
//
// Turns adjusted OHLCV bars into `Stock` objects carrying the last-bar figures
// and the indicator series the fan screener, backtest, signal scan and charts
// read. Pure and isomorphic: bars are passed in, never fetched here; the
// synthetic generator and SQLite adapter live behind the provider port in
// ./data. The indicator math itself lives in ./indicators.ts.

import { ema, sma, rsi, stochRsi, macd } from './indicators.ts';

// ---------- shared types ----------
export interface OHLC {
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v?: number[];
  // ISO 'YYYY-MM-DD' calendar date per bar, parallel to the OHLC arrays. The
  // engine never reads it (it has no notion of "today"); it is carried through
  // solely so the charts can label the real trading days instead of fabricating
  // them. Optional: fixtures that omit dates still build.
  d?: string[];
}

export interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Stock {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  pct52w: number;
  relVol: number;
  avgVol20: number;
  /** null when shares outstanding is not imported for this name */
  marketCap: number | null;
  hi52: number;
  lo52: number;
  rsi: number;
  macdHist: number;
  macdLine: number;
  macdSignal: number;
  stochK: number;
  stochD: number;
  ema9: number;
  ema20: number;
  ema50: number;
  ema200: number;
  macdCrossUp: boolean;
  macdCrossDown: boolean;
  goldenCross: boolean;
  deathCross: boolean;
  stochCrossUp: boolean;
  sparkline: number[];
  /** the visible chart window (last VISIBLE bars) */
  series: Bar[];
  /** indicator series over the visible chart window */
  ind: {
    ema9: number[];
    ema20: number[];
    ema50: number[];
    ema200: number[];
    rsi: number[];
    stochK: (number | null)[];
    stochD: (number | null)[];
    macdLine: number[];
    macdSignal: number[];
    macdHist: number[];
    volAvg20: (number | null)[];
  };
  /** the full history, column-wise */
  full: OHLC;
  nLast: number;
  visStart: number;
}

// Per-horizon forward-return summary of a set of entries.
export interface HorizonStat {
  h: number;
  n: number;
  avg: number;
  median: number;
  winRate: number;
  best: number;
  worst: number;
}

// ---------- universe ----------
const VISIBLE = 130;    // days shown on detail chart
const CROSS_LOOKBACK = 5; // bars back for the golden/death-cross check

function pct(a: number, b: number): number { return ((a - b) / b) * 100; }

// Engine input contract: universe metadata + adjusted OHLCV bars. Bars are
// passed in and already corporate-action adjusted at ingestion. Adapters behind
// the MarketDataProvider port produce these; the engine builds Stocks from them
// and never fetches.
export interface InstrumentBars {
  ticker: string;
  name: string;
  sector: string;
  bars: Bar[];
  // Calendar dates ('YYYY-MM-DD') parallel to `bars`, in the same chronological
  // order. Kept beside `bars` rather than inside `Bar` so the engine `Bar` stays
  // pure OHLCV; only the charts consume it. Optional so existing providers and
  // fixtures that predate it still satisfy the contract.
  dates?: string[];
  /** Shares outstanding when known (import metadata). Used for market-cap display/filter. */
  sharesOutstanding?: number;
}

// Build the full set of Stocks (with computed indicators) from adjusted bars.
export function buildUniverse(instruments: InstrumentBars[]): Stock[] {
  return instruments.map(buildStock);
}

// Build one Stock — all indicator math + last-bar figures — from its metadata + bars.
export function buildStock({ ticker, name, sector, bars, dates, sharesOutstanding }: InstrumentBars): Stock {
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

  const n = closes.length - 1;
  const price = closes[n];
  const changePct = pct(closes[n], closes[n - 1]);
  const hi52 = Math.max(...closes);
  const lo52 = Math.min(...closes);
  const pct52w = ((price - lo52) / (hi52 - lo52)) * 100; // 0..100 position in range
  const relVol = volAvg20[n] ? vols[n] / (volAvg20[n] as number) : 1;
  const avgVol20 = volAvg20[n] != null ? (volAvg20[n] as number) : 0;
  const marketCap = sharesOutstanding != null && sharesOutstanding > 0
    ? price * sharesOutstanding
    : null;

  // crossover detections (last bar)
  const macdCrossUp = mac.line[n] > mac.signal[n] && mac.line[n - 1] <= mac.signal[n - 1];
  const macdCrossDown = mac.line[n] < mac.signal[n] && mac.line[n - 1] >= mac.signal[n - 1];
  const goldenCross = ema50[n] > ema200[n] && ema50[n - CROSS_LOOKBACK] <= ema200[n - CROSS_LOOKBACK];
  const deathCross = ema50[n] < ema200[n] && ema50[n - CROSS_LOOKBACK] >= ema200[n - CROSS_LOOKBACK];
  const stochCrossUp = (sr.k[n] as number) > (sr.d[n] as number) && (sr.k[n - 1] as number) <= (sr.d[n - 1] as number);

  return {
    ticker, name, sector,
    price, changePct, pct52w, relVol, avgVol20, marketCap, hi52, lo52,
    rsi: rsiArr[n], macdHist: mac.hist[n], macdLine: mac.line[n], macdSignal: mac.signal[n],
    stochK: sr.k[n] ?? 50, stochD: sr.d[n] ?? 50,
    ema9: ema9[n], ema20: ema20[n], ema50: ema50[n], ema200: ema200[n],
    macdCrossUp, macdCrossDown, goldenCross, deathCross, stochCrossUp,
    sparkline: closes.slice(-40),
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
    full: { o: bars.map(b => b.o), h: bars.map(b => b.h), l: bars.map(b => b.l), c: closes.slice(), v: vols, d: dates },
    nLast: closes.length - 1,
    visStart: closes.length - VISIBLE,
  };
}
