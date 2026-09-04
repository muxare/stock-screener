// instrument.test.ts — STORY-024 acceptance harness for the per-instrument bar
// endpoint (the per-displayed-name bar source that unblocks STORY-018).
//
// Proves the acceptance criteria: the MarketDataProvider port serves one name's
// bars (bar-for-bar identical to that name in getUniverse), the Node service
// exposes a read endpoint returning the engine's InstrumentBars shape keyed by
// ticker (404 on unknown), serving one name never triggers a full-universe
// build (SAD#2.5), and a single-name fetch + buildStock meets the SAD#2.3 50 ms
// budget — all over the SHARED engine and the SAD#5.10 provider port.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildStock } from '../src/lib/market.ts';
import type { Bar, InstrumentBars } from '../src/lib/market.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { createUniverseStore } from './universe.ts';
import { createScreenServer } from './index.ts';

// Same synthetic adapter (behind the port, SAD#5.10) the golden-master harness pins.
const provider = syntheticProvider(7);
const store = createUniverseStore(provider);

describe('provider port: per-instrument bars (SAD#5.10)', () => {
  it('returns one name bar-for-bar identical to that name in getUniverse()', () => {
    const universe = provider.getUniverse();
    for (const want of universe) {
      const got = provider.getInstrument(want.ticker);
      expect(got).toEqual(want); // metadata + every OHLCV bar identical
    }
  });

  it('returns null for an unknown ticker', () => {
    expect(provider.getInstrument('NOPE')).toBeNull();
    expect(provider.getInstrument('')).toBeNull();
  });

  it('serves a single name WITHOUT building the full universe (SAD#2.5)', () => {
    // A fresh store whose provider counts getUniverse() calls; getInstrument
    // must not trigger one.
    let universeBuilds = 0;
    const counting = {
      getUniverse() { universeBuilds++; return provider.getUniverse(); },
      getInstrument(t: string) { return provider.getInstrument(t); },
    };
    const s = createUniverseStore(counting);
    const bars = s.getInstrument('AAPL');
    expect(bars?.ticker).toBe('AAPL');
    expect(universeBuilds).toBe(0);
  });
});

describe('single-name build budget (SAD#2.3)', () => {
  it('fetch + buildStock for one name stays well under 50 ms', () => {
    const bars = store.getInstrument('NVDA') as InstrumentBars;
    const t0 = performance.now();
    const stock = buildStock(bars);
    const elapsed = performance.now() - t0;
    expect(stock.ticker).toBe('NVDA');
    expect(stock.full.c.length).toBe(bars.bars.length); // bars survive the build
    expect(elapsed).toBeLessThan(50);
  });
});

describe('HTTP/JSON endpoint (SAD#4.2)', () => {
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /instrument/:ticker returns the InstrumentBars payload', async () => {
    const r = await fetch(`${base}/instrument/AAPL`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as InstrumentBars;
    expect(body.ticker).toBe('AAPL');
    expect(typeof body.name).toBe('string');
    expect(typeof body.sector).toBe('string');
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBe(260);
    // bars carry adjusted OHLCV (SAD#6.1)
    const b = body.bars[0] as Bar;
    for (const k of ['o', 'h', 'l', 'c', 'v'] as const) expect(typeof b[k]).toBe('number');
    // identical to the provider/getUniverse entry — the wire is a faithful pass-through
    expect(body).toEqual(provider.getInstrument('AAPL'));
  });

  it('GET /instrument/:ticker answers 400 to a malformed percent-encoding and stays up', async () => {
    const r = await fetch(`${base}/instrument/%E0%A4%A`);
    expect(r.status).toBe(400);
    // the process survived: the next request is served normally
    const ok = await fetch(`${base}/instrument/AAPL`);
    expect(ok.status).toBe(200);
  });

  it('GET /instrument/:ticker returns 404 for an unknown ticker', async () => {
    const r = await fetch(`${base}/instrument/NOPE`);
    expect(r.status).toBe(404);
    await close();
  });
});
