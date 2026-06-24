// store.client.test.ts — STORY-018 acceptance harness for the client wiring.
//
// Proves the web client (SAD#4.1) sources full-universe data from the screening
// service (SAD#4.2) instead of computing it in the browser (SAD#2.5 / AC1, AC4):
// the store's screen result, the "of N" total, sector facets, and preset match
// counts all arrive over HTTP/JSON, displayed names pull their bars on demand,
// and a backtest streams back from the service. The store talks to the SAME
// in-process server the other harnesses boot, over the shared engine.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createScreenServer } from '../server/index.ts';
import { createUniverseStore } from '../server/universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';

// Minimal in-memory localStorage (the store persists view prefs there).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

let close: () => Promise<void>;

beforeAll(async () => {
  const store = createUniverseStore(syntheticProvider(7));
  const server = createScreenServer(store);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));

  // The store fetches same-origin paths (vite proxies them in dev). In this
  // node harness, rewrite those relative paths onto the in-process server and
  // give the store a localStorage. Set up BEFORE importing the store.
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' && input.startsWith('/') ? base + input : input;
    return realFetch(url as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;
});

afterAll(() => close());

async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

describe('client sources full-universe data from the service (SAD#2.5)', () => {
  it('init() populates the screen result, total, sectors and preset counts over HTTP', async () => {
    const { useScreener } = await import('../src/store.ts');
    useScreener.getState().init();

    // The active screen lands from /screen (AC1/AC4); the universe-wide facts
    // (total, sectors) arrive from a parallel bootstrap fetch.
    expect(await waitFor(() => useScreener.getState().screen != null && useScreener.getState().universeSize > 0)).toBe(true);
    const st = useScreener.getState();
    expect(st.universeSize).toBe(44);              // the "of N" total
    expect(st.screen!.total).toBeGreaterThan(0);
    expect(st.screen!.rows.length).toBe(st.screen!.total); // full matched set, not a page
    expect(st.screen!.rows[0].sparkline.length).toBe(40);  // row carries its own spark
    expect(st.sectorList.length).toBeGreaterThan(0);        // sector facets

    // Per-preset match counts arrive from the service, not a local sweep.
    expect(await waitFor(() => Object.keys(useScreener.getState().presetCounts).length > 0)).toBe(true);
    expect(useScreener.getState().presetCounts['macdmomo']).toBeGreaterThanOrEqual(0);

    // A sample name for the indicator preview was fetched (displayed-name compute).
    expect(await waitFor(() => useScreener.getState().sampleStock != null)).toBe(true);
    expect(useScreener.getState().sampleStock!.full.c.length).toBeGreaterThan(0);
  });

  it('fetches bars on demand only for displayed names (SAD#4.1)', async () => {
    const { useScreener } = await import('../src/store.ts');
    const ticker = useScreener.getState().screen!.tickers[0];
    await useScreener.getState().ensureDisplayed(ticker);
    const stock = useScreener.getState().displayed[ticker];
    expect(stock?.ticker).toBe(ticker);
    expect(stock!.full.c.length).toBeGreaterThan(0); // built locally from the bars
  });

  it('previewCount returns a full-universe count for an ad-hoc rule set', async () => {
    const { useScreener } = await import('../src/store.ts');
    const all = await useScreener.getState().previewCount([]);
    expect(all).toBe(44); // empty rule set matches the whole universe
  });

  it('runs the backtest server-side and streams back a summary (SAD#2.4)', async () => {
    const { useScreener } = await import('../src/store.ts');
    useScreener.getState().openBacktest();
    expect(useScreener.getState().backtestRunning).toBe(true);
    expect(await waitFor(() => useScreener.getState().backtestResult != null, 15000)).toBe(true);
    const r = useScreener.getState().backtestResult!;
    expect(typeof r.signals).toBe('number');
    expect(Array.isArray(r.horizons)).toBe(true);
    expect(useScreener.getState().backtestRunning).toBe(false);
  });
});
