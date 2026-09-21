// holdings.test.ts — what survives a round trip through localStorage.
//
// The interesting cases are all the same case: something that is not what this
// module wrote is in storage, and the app must carry on. A hand-edited entry, a
// half-written value, a key from an older shape — each one is dropped, and none
// of them takes the screener down on start-up.

import { describe, it, expect } from 'vitest';
import {
  PORTFOLIO_KEY,
  clearPortfolio,
  heldTickers,
  loadPortfolio,
  parseHolding,
  savePortfolio,
  type Portfolio,
  type PortfolioStorage,
} from './holdings.ts';

function storage(initial?: string): PortfolioStorage {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(PORTFOLIO_KEY, initial);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

const PORTFOLIO: Portfolio = {
  accountLabel: 'ISK',
  holdings: [
    { ticker: 'AAPL', name: 'Apple Inc', shares: 10, averagePrice: 150, currency: 'USD' },
    { ticker: null, name: 'Volvo B', shares: null, averagePrice: null, currency: 'SEK' },
  ],
  confirmedAt: '2026-09-21T10:00:00.000Z',
};

describe('parseHolding', () => {
  it('uppercases the ticker so a marker matches the universe', () => {
    expect(parseHolding({ ticker: ' aapl ', name: 'Apple' })?.ticker).toBe('AAPL');
  });

  it('keeps a row that has only a name — an unresolved ticker is still a holding', () => {
    expect(parseHolding({ name: 'Volvo B' })).toMatchObject({ ticker: null, name: 'Volvo B' });
  });

  it('drops a row that identifies nothing, whatever numbers it carries', () => {
    expect(parseHolding({ shares: 100, averagePrice: 12 })).toBeNull();
    expect(parseHolding('AAPL')).toBeNull();
    expect(parseHolding(null)).toBeNull();
  });

  it('refuses a number that is not one', () => {
    const row = parseHolding({ name: 'Apple', shares: '10', averagePrice: Number.NaN });
    expect(row).toMatchObject({ shares: null, averagePrice: null });
  });
});

describe('loadPortfolio', () => {
  it('round-trips what was saved', () => {
    const s = storage();
    savePortfolio(s, PORTFOLIO);
    expect(loadPortfolio(s)).toEqual(PORTFOLIO);
  });

  it('is null with no storage at all, which is how the Node tests run', () => {
    expect(loadPortfolio(null)).toBeNull();
  });

  it('survives every shape of rubbish in the key', () => {
    expect(loadPortfolio(storage('not json'))).toBeNull();
    expect(loadPortfolio(storage('null'))).toBeNull();
    expect(loadPortfolio(storage('[]'))).toBeNull();
    expect(loadPortfolio(storage('{"holdings":"lots"}'))).toBeNull();
  });

  it('keeps the readable rows of a partly broken list', () => {
    const raw = JSON.stringify({ holdings: [{ name: 'Apple' }, 42, { shares: 3 }], confirmedAt: '2026-09-21T10:00:00.000Z' });
    const loaded = loadPortfolio(storage(raw));
    expect(loaded?.holdings).toHaveLength(1);
    expect(loaded?.holdings[0].name).toBe('Apple');
  });

  it('survives a storage that throws rather than answering', () => {
    const hostile: PortfolioStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(loadPortfolio(hostile)).toBeNull();
    expect(() => savePortfolio(hostile, PORTFOLIO)).not.toThrow();
    expect(() => clearPortfolio(hostile)).not.toThrow();
  });

  it('reads nothing back after a clear', () => {
    const s = storage();
    savePortfolio(s, PORTFOLIO);
    clearPortfolio(s);
    expect(loadPortfolio(s)).toBeNull();
  });
});

describe('heldTickers', () => {
  it('marks only the rows that resolved to a ticker', () => {
    const held = heldTickers(PORTFOLIO);
    expect(held.has('AAPL')).toBe(true);
    // "Volvo B" is a name Avanza prints, not a ticker the universe is keyed by,
    // and guessing the mapping is the inference this feature refuses to make.
    expect(held.size).toBe(1);
  });

  it('is empty without a portfolio', () => {
    expect(heldTickers(null).size).toBe(0);
  });
});
