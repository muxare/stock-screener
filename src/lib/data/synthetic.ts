// synthetic.ts — synthetic MarketDataProvider adapter (ADR-007 / SAD#8.7).
//
// DEV/TEST ONLY. The mulberry32 universe is a deterministic demo fixture, not a
// market feed (SAD#1.2). It survives solely as a `MarketDataProvider` adapter
// for development and golden-master fixtures (STORY-020); it must never appear
// in a production data path. Production data is the vendor adapter (ADR-008).
//
// The generator was extracted verbatim from the POC `market.js` /
// `src/lib/market.ts` so numeric output is bar-for-bar identical (SAD#2.1).

import type { Bar } from '../market';
import type { InstrumentBars, MarketDataProvider } from './provider';

// ---------- seeded RNG ----------
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- universe ----------
const TICKERS: [string, string, string][] = [
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

// Synthetic bars carry fabricated weekday dates so the detail chart has a real
// date axis to label (the engine itself ignores them, ADR-002). Anchored to a
// FIXED end date — never Date.now() — so the demo universe and its golden-master
// fixtures stay bit-for-bit deterministic across runs.
const SYNTH_END = '2026-06-19';

// `count` weekday ISO dates ('YYYY-MM-DD') ending at (and including) `endIso`,
// returned ascending so they align index-for-index with the chronological bars.
function genDates(count: number, endIso: string): string[] {
  const [ey, em, ed] = endIso.split('-').map(Number);
  const d = new Date(ey, em - 1, ed);
  const out: string[] = [];
  while (out.length < count) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

function genSeries(rand: () => number, startPrice: number): Bar[] {
  // regime-based geometric random walk with occasional trend shifts
  const closes: number[] = [];
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
  const bars: Bar[] = [];
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

// Generate instrument `idx` exactly as the full universe does. `getUniverse`
// draws every instrument's `startPrice` from ONE seed-stream advanced once per
// instrument in order, so reproducing instrument `idx` in isolation means
// advancing a fresh stream `idx + 1` times for its `startPrice`; the bar series
// then uses the same independent per-instrument stream. The result is therefore
// bar-for-bar identical to the matching name in `getUniverse()` — the single
// source of truth both entry points share (pinned in server/instrument.test.ts).
function instrumentAt(seed: number, idx: number): InstrumentBars {
  const [ticker, name, sector] = TICKERS[idx];
  const priceRand = mulberry32(seed);
  let startPrice = 0;
  for (let i = 0; i <= idx; i++) startPrice = 18 + priceRand() * 380;
  const bars = genSeries(mulberry32(seed * 131 + idx * 977), startPrice);
  const sharesOutstanding = Math.round(25e6 + idx * 95e6 + priceRand() * 180e6);
  return { ticker, name, sector, bars, dates: genDates(bars.length, SYNTH_END), sharesOutstanding };
}

/**
 * A synthetic `MarketDataProvider` seeded for deterministic output. The same
 * `seed` always yields the same universe — used to simulate a fresh session in
 * dev and to pin golden-master fixtures in test. RNG call order is preserved
 * exactly from the POC so values match bar-for-bar.
 */
export function syntheticProvider(seed = 7): MarketDataProvider {
  return {
    getUniverse(): InstrumentBars[] {
      return TICKERS.map((_, idx) => instrumentAt(seed, idx));
    },
    getInstrument(ticker: string): InstrumentBars | null {
      const idx = TICKERS.findIndex((t) => t[0] === ticker);
      return idx < 0 ? null : instrumentAt(seed, idx);
    },
  };
}
