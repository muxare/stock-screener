// portfolioSlice.test.ts — the proposal-until-confirmed rule, as behaviour.
//
// One assertion matters more than the rest and every other case is arranged
// around it: an extraction must not reach storage. The store may hold it, the
// modal may show it, and only `confirmHoldings` may write it down.

import { describe, it, expect, vi } from 'vitest';
import { create } from 'zustand';
import { makeScreenerState, type ScreenerState } from '../store.ts';
import { parseDataUrl } from './portfolioSlice.ts';
import { PORTFOLIO_KEY, type PortfolioStorage } from '../lib/portfolio/holdings.ts';
import type { ExtractPortfolioResp, MarketClient } from '../lib/client/marketClient.ts';

function storage(initial?: string): PortfolioStorage & { raw: () => string | null } {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(PORTFOLIO_KEY, initial);
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    raw: () => map.get(PORTFOLIO_KEY) ?? null,
  };
}

const RESPONSE: ExtractPortfolioResp = {
  extraction: {
    accountLabel: 'ISK',
    holdings: [
      { ticker: 'AAPL', name: 'Apple Inc', shares: 10, averagePrice: 150, lastPrice: 200, marketValue: 2000, currency: 'USD', valueCurrency: 'USD', confidence: 'high', note: null },
      { ticker: null, name: 'Volvo B', shares: null, averagePrice: null, lastPrice: null, marketValue: null, currency: 'SEK', valueCurrency: 'SEK', confidence: 'low', note: 'the row is cut off' },
      { ticker: 'MSFT', name: 'Microsoft', shares: 5, averagePrice: 300, lastPrice: 310, marketValue: 1550, currency: 'USD', valueCurrency: 'USD', confidence: 'medium', note: null },
    ],
    warnings: ['the table continues below the visible area'],
  },
  attempts: 2,
  problems: ['row 3 (MSFT): shares x last price does not match the market value'],
};

function client(over: Partial<MarketClient> = {}): MarketClient {
  return {
    facts: async () => ({ total: 0, sectors: [], sample: null }),
    instrument: async () => null,
    screen: async () => ({ universe: 0, elapsedMs: 0, matches: [], near: [] }),
    signals: async () => ({ universe: 0, elapsedMs: 0, strategy: '', strategyName: '', rows: [] }),
    backtest: async () => { throw new Error('not used'); },
    portfolioStatus: async () => ({ available: true, model: 'claude-opus-5' }),
    extractPortfolio: async () => RESPONSE,
    devImportOptions: async () => null,
    devImport: async () => { throw new Error('not used'); },
    databases: async () => null,
    activateDatabase: async () => ({ activeKind: 'synthetic', activePath: null, universe: 0 }),
    ...over,
  };
}

const makeStore = (c: MarketClient = client(), s: PortfolioStorage | null = null) =>
  create<ScreenerState>(makeScreenerState(c, s));

const PNG = 'data:image/png;base64,aGVsbG8=';

describe('parseDataUrl', () => {
  it('splits what a FileReader produces into what the route accepts', () => {
    expect(parseDataUrl(PNG)).toEqual({ mediaType: 'image/png', dataBase64: 'aGVsbG8=' });
  });

  it('is null for anything else', () => {
    expect(parseDataUrl('aGVsbG8=')).toBeNull();
    expect(parseDataUrl('data:text/plain;base64,aGk=')).toEqual({ mediaType: 'text/plain', dataBase64: 'aGk=' });
  });
});

describe('probePortfolio', () => {
  it('hides the feature when the service reports no key', async () => {
    const store = makeStore(client({ portfolioStatus: async () => ({ available: false, model: 'claude-opus-5' }) }));
    await store.getState().probePortfolio();
    expect(store.getState().portfolio.available).toBe(false);
  });

  it('hides it when the service does not answer at all', async () => {
    const store = makeStore(client({ portfolioStatus: async () => null }));
    await store.getState().probePortfolio();
    expect(store.getState().portfolio.available).toBe(false);
  });
});

describe('extractHoldings', () => {
  it('shows the least certain rows first', async () => {
    const store = makeStore();
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();
    expect(store.getState().portfolio.rows.map((r) => r.confidence)).toEqual(['low', 'medium', 'high']);
  });

  it('carries the attempt count, the warnings and the unresolved problems through', async () => {
    const store = makeStore();
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();
    const p = store.getState().portfolio;
    expect(p.attempts).toBe(2);
    expect(p.warnings).toHaveLength(1);
    expect(p.problems).toHaveLength(1);
    expect(p.accountLabel).toBe('ISK');
  });

  it('surfaces a service failure as an error rather than as empty rows', async () => {
    const store = makeStore(client({ extractPortfolio: async () => { throw new Error('rate limited by the API'); } }));
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();
    expect(store.getState().portfolio.extracting).toBe(false);
    expect(store.getState().portfolio.error).toBe('rate limited by the API');
    expect(store.getState().portfolio.rows).toEqual([]);
  });

  it('does nothing without an image, and refuses one the browser could not read', async () => {
    const extract = vi.fn(async () => RESPONSE);
    const store = makeStore(client({ extractPortfolio: extract }));
    await store.getState().extractHoldings();
    expect(extract).not.toHaveBeenCalled();

    store.getState().setScreenshot('not a data url');
    await store.getState().extractHoldings();
    expect(extract).not.toHaveBeenCalled();
    expect(store.getState().portfolio.error).toContain('image');
  });
});

describe('the proposal is never a fact', () => {
  it('writes nothing to storage until the user confirms', async () => {
    const s = storage();
    const store = makeStore(client(), s);
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();

    expect(store.getState().portfolio.rows).toHaveLength(3);
    expect(s.raw()).toBeNull();
    expect(store.getState().portfolio.confirmed).toBeNull();

    store.getState().confirmHoldings();
    expect(s.raw()).not.toBeNull();
    expect(store.getState().portfolio.confirmed?.holdings).toHaveLength(3);
  });

  it('stores the edits, not what Claude read', async () => {
    const s = storage();
    const store = makeStore(client(), s);
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();

    // Row 0 is the low-confidence one — the cut-off row, with a name and no
    // numbers. This is the correction the confirm UI exists for.
    store.getState().editHolding(0, { ticker: 'volv-b', shares: 120, averagePrice: 241.5 });
    store.getState().confirmHoldings();

    const stored = store.getState().portfolio.confirmed!.holdings[0];
    expect(stored).toEqual({ ticker: 'VOLV-B', name: 'Volvo B', shares: 120, averagePrice: 241.5, currency: 'SEK' });
  });

  it('drops the rows the user unticked', async () => {
    const store = makeStore();
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();
    store.getState().toggleHolding(0);
    store.getState().toggleHolding(1);
    store.getState().confirmHoldings();
    expect(store.getState().portfolio.confirmed?.holdings).toHaveLength(1);
  });

  it('refuses to confirm nothing at all', async () => {
    const s = storage();
    const store = makeStore(client(), s);
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();
    for (let i = 0; i < 3; i += 1) store.getState().toggleHolding(i);
    store.getState().confirmHoldings();
    expect(s.raw()).toBeNull();
    expect(store.getState().portfolio.error).toContain('every row is unticked');
  });

  it('throws the proposal away on close, so a half-read table is not confirmed later', async () => {
    const store = makeStore();
    store.getState().setScreenshot(PNG);
    await store.getState().extractHoldings();
    store.getState().closePortfolio();
    const p = store.getState().portfolio;
    expect(p.rows).toEqual([]);
    expect(p.imageDataUrl).toBeNull();
    expect(p.problems).toEqual([]);
  });

  it('loads a previously confirmed portfolio at start-up, and forgets it on request', async () => {
    const s = storage();
    const first = makeStore(client(), s);
    first.getState().setScreenshot(PNG);
    await first.getState().extractHoldings();
    first.getState().confirmHoldings();

    const second = makeStore(client(), s);
    expect(second.getState().portfolio.confirmed?.holdings).toHaveLength(3);

    second.getState().forgetPortfolio();
    expect(second.getState().portfolio.confirmed).toBeNull();
    expect(makeStore(client(), s).getState().portfolio.confirmed).toBeNull();
  });
});
