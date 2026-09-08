import { describe, it, expect, beforeAll } from 'vitest';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { createUniverseStore } from './universe.ts';
import { runFanScreen } from './screen.ts';
import { handleScreen } from './handlers.ts';
import { createScreenServer } from './index.ts';
import { classifyCloses } from '../src/lib/fan.ts';
import { EMPTY_SNAPSHOT } from '../src/lib/screen/snapshot.ts';

const store = createUniverseStore(syntheticProvider(7));

beforeAll(() => {
  store.get();
});

describe('EMA-fan screen over the full universe', () => {
  it('matches runFanScreen to per-name classifyCloses', () => {
    const universe = store.get();
    expect(universe.length).toBe(44);
    const { matches, near } = runFanScreen(universe);
    const matchSet = new Set(matches.map((r) => r.ticker));
    const nearSet = new Set(near.map((r) => r.ticker));
    expect([...matchSet].some((t) => nearSet.has(t))).toBe(false);

    for (const s of universe) {
      const status = classifyCloses(s.full.c).status;
      expect(matchSet.has(s.ticker)).toBe(status === 'match');
      expect(nearSet.has(s.ticker)).toBe(status === 'near');
    }
  });

  it('projects fan rows with the four EMAs and worstGap', () => {
    const res = handleScreen(store.get());
    expect(res.universe).toBe(44);
    const rows = [...res.matches, ...res.near];
    expect(rows.every((r) =>
      typeof r.ticker === 'string'
      && typeof r.ema18 === 'number'
      && typeof r.ema50 === 'number'
      && typeof r.ema100 === 'number'
      && typeof r.ema200 === 'number'
      && r.ema200Ago != null
      && typeof r.worstGap === 'number'
      && Array.isArray(r.sparkline),
    )).toBe(true);
    for (let i = 1; i < res.matches.length; i++) {
      expect(res.matches[i - 1].worstGap).toBeGreaterThanOrEqual(res.matches[i].worstGap);
    }
    for (let i = 1; i < res.near.length; i++) {
      expect(res.near[i - 1].worstGap).toBeGreaterThanOrEqual(res.near[i].worstGap);
    }
  });

  it('carries an indicator snapshot on every row', () => {
    const res = handleScreen(store.get());
    const rows = [...res.matches, ...res.near];
    expect(rows.length).toBeGreaterThan(0);
    const keys = Object.keys(EMPTY_SNAPSHOT).sort() as (keyof typeof EMPTY_SNAPSHOT)[];
    for (const r of rows) {
      expect(Object.keys(r.snapshot).sort()).toEqual(keys);
      // The synthetic universe has full OHLCV and long histories, so every
      // number is real, not a warm-up NaN.
      for (const k of keys) expect(Number.isFinite(r.snapshot[k]), `${r.ticker}.${k}`).toBe(true);
      expect(r.snapshot.rsi14).toBeGreaterThanOrEqual(0);
      expect(r.snapshot.rsi14).toBeLessThanOrEqual(100);
      expect(r.snapshot.hi52).toBeGreaterThanOrEqual(r.snapshot.lo52);
    }
  });
});

describe('warm-cache latency budget: p95 ≤ 3s', () => {
  it('keeps a full-universe fan screen well within budget', () => {
    const universe = store.get();
    handleScreen(universe);
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      handleScreen(universe);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(3000);
  });
});

describe('HTTP/JSON endpoint', () => {
  it('GET /health reports the warm universe size', async () => {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, universe: 44 });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /screen returns matches and near', async () => {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/screen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { universe: number; matches: unknown[]; near: unknown[]; elapsedMs: number };
    expect(body.universe).toBe(44);
    expect(Array.isArray(body.matches)).toBe(true);
    expect(Array.isArray(body.near)).toBe(true);
    expect(typeof body.elapsedMs).toBe('number');
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
