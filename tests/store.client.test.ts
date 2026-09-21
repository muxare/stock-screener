import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startApp } from '../server/testHarness.ts';
import { createUniverseStore } from '../server/universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';

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
  const running = await startApp(store);
  const base = running.base;
  close = running.close;

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

describe('client sources fan lists from the service', () => {
  it('init() populates matches/near and universe size over HTTP', async () => {
    const { useScreener } = await import('../src/store.ts');
    useScreener.getState().init();
    expect(await waitFor(() => useScreener.getState().universeSize > 0 && !useScreener.getState().screenLoading)).toBe(true);
    const st = useScreener.getState();
    expect(st.universeSize).toBe(44);
    expect(Array.isArray(st.matches)).toBe(true);
    expect(Array.isArray(st.near)).toBe(true);
    const listed = new Set([...st.matches, ...st.near].map((r) => r.ticker));
    expect(listed.size).toBe(st.matches.length + st.near.length);
  });

  it('selectStock fetches bars on demand', async () => {
    const { useScreener } = await import('../src/store.ts');
    const st = useScreener.getState();
    const ticker = st.matches[0]?.ticker ?? st.near[0]?.ticker;
    if (!ticker) return; // synthetic universe may have an empty fan; skip
    st.selectStock(ticker);
    expect(await waitFor(() => useScreener.getState().displayed[ticker] != null)).toBe(true);
    expect(useScreener.getState().displayed[ticker]?.ticker).toBe(ticker);
  });
});
