// screen.test.ts — STORY-016 acceptance harness for the screening service.
//
// Proves the four acceptance criteria: the service reuses the SHARED engine
// over the full production universe, exposes an HTTP/JSON screen endpoint, meets
// the SAD#2.3 warm-cache p95 budget, and is stateless while honouring the
// per-Stock indicator cache.

import { describe, it, expect, beforeAll } from 'vitest';
import { evalGroupedRules, PRESETS } from '../src/lib/market.ts';
import type { Rule, Stock } from '../src/lib/market.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { createUniverseStore } from './universe.ts';
import { runScreen } from './screen.ts';
import { handleScreen } from './handlers.ts';
import { createScreenServer } from './index.ts';

// Deterministic production-universe stand-in (synthetic adapter behind the port,
// SAD#5.10) — the same adapter the golden-master harness pins.
const store = createUniverseStore(syntheticProvider(7));

const OVERSOLD: Rule[] = PRESETS.find((p) => p.id === 'oversold')!.rules;

beforeAll(() => {
  // Warm the universe once (build + first evaluation) before timing/cache asserts.
  store.get();
});

describe('shared engine over the full universe (SAD#4.2 / SAD#8.3)', () => {
  it('screens the entire production universe via the engine entry points', () => {
    const universe = store.get();
    expect(universe.length).toBe(44);
    // runScreen is pure composition of the engine: parity with a direct
    // evalGroupedRules sweep proves there is no second implementation.
    const direct = universe.filter((s) => evalGroupedRules(s, OVERSOLD)).map((s) => s.ticker);
    const viaService = runScreen(universe, OVERSOLD).map((s) => s.ticker);
    expect(viaService).toEqual(direct);
  });

  it('resolves a built-in preset and returns a row projection', () => {
    const res = handleScreen(store.get(), { preset: 'oversold' });
    expect(res.total).toBe(res.tickers.length);
    expect(res.results.every((r) => typeof r.ticker === 'string' && typeof r.price === 'number')).toBe(true);
  });

  it('rejects an unknown preset as a client error', () => {
    expect(() => handleScreen(store.get(), { preset: 'nope' })).toThrow();
  });
});

describe('warm-cache latency budget (SAD#2.3): p95 ≤ 3s', () => {
  it('keeps a full-universe screen well within budget', () => {
    const universe = store.get();
    handleScreen(universe, { preset: 'tc_bounce_long' }); // ensure caches warm
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      handleScreen(universe, { preset: 'tc_bounce_long' });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(3000);
  });
});

describe('honours the indicator cache (SAD#5.7)', () => {
  it('reuses the same warm universe and its per-Stock caches across calls', () => {
    expect(store.get()).toBe(store.get()); // memoized: same reference
    handleScreen(store.get(), { preset: 'tc_bounce_long' });
    // tc_bounce_long evaluates EMA chains via indSeries(), which caches on _indCache.
    const anyCached = store.get().some((s: Stock) => s._indCache && Object.keys(s._indCache).length > 0);
    expect(anyCached).toBe(true);
  });
});

describe('stateless w.r.t. user identity', () => {
  it('identical requests yield identical results regardless of intervening calls', () => {
    const a = handleScreen(store.get(), { preset: 'macdmomo' });
    handleScreen(store.get(), { preset: 'volbreak' }); // unrelated request in between
    const b = handleScreen(store.get(), { preset: 'macdmomo' });
    expect(b.tickers).toEqual(a.tickers);
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

  it('GET /health reports the warm universe size', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; universe: number };
    expect(body).toEqual({ ok: true, universe: 44 });
  });

  it('POST /screen evaluates the full universe and returns JSON', async () => {
    const r = await fetch(`${base}/screen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'oversold' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { total: number; tickers: string[]; results: unknown[]; elapsedMs: number };
    expect(body.total).toBe(body.tickers.length);
    expect(Array.isArray(body.results)).toBe(true);
    expect(typeof body.elapsedMs).toBe('number');

    await close();
  });

  it('POST /screen rejects invalid JSON with 400', async () => {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/screen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(r.status).toBe(400);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
