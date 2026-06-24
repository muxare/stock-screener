// backtest.test.ts — STORY-017 acceptance harness for the backtest service.
//
// Proves the four acceptance criteria: a backtest endpoint runs `backtestRules`
// over the full universe server-side (SAD#4.2 / SAD#8.3), full-universe +
// full-history completes within the SAD#2.4 budget, the result is the single
// SAD#6.5 summary payload, and long-running backtests report progress without
// blocking the UI thread (compute is server-side, progress is streamed).

import { describe, it, expect, beforeAll } from 'vitest';
import { backtestRules, PRESETS } from '../src/lib/market.ts';
import type { Rule, RankRule } from '../src/lib/market.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { createUniverseStore } from './universe.ts';
import { runBacktest, NAIVE_LABEL } from './backtest.ts';
import { handleBacktest } from './handlers.ts';
import { createScreenServer } from './index.ts';

// Same deterministic production-universe stand-in the screen harness pins.
const store = createUniverseStore(syntheticProvider(7));

const OVERSOLD: Rule[] = PRESETS.find((p) => p.id === 'oversold')!.rules;

beforeAll(() => {
  store.get(); // warm the universe once before timing/parity asserts
});

describe('shared engine over the full universe (SAD#4.2 / SAD#8.3)', () => {
  it('backtests the entire production universe via the engine entry point', () => {
    const universe = store.get();
    expect(universe.length).toBe(44);
    // Parity with a direct backtestRules sweep proves there is no second
    // implementation — runBacktest is pure composition of the shared engine.
    const direct = backtestRules(universe, OVERSOLD);
    const viaService = runBacktest(universe, OVERSOLD);
    expect(viaService).toEqual(direct);
  });

  it('excludes rank rules from history (SAD#3.8), matching the client', () => {
    const universe = store.get();
    const rank: RankRule = { kind: 'rank', field: 'relVol', pct: 10, dir: 'top' } as RankRule;
    // A rank rule ANDed on must not change the backtest: it is dropped from
    // history exactly as `store.openBacktest` drops it.
    const withRank = runBacktest(universe, [...OVERSOLD, rank]);
    const withoutRank = runBacktest(universe, OVERSOLD);
    expect(withRank).toEqual(withoutRank);
  });
});

describe('single summary payload (SAD#6.5) + naive label (SAD#2.7)', () => {
  it('returns the SAD#6.5 shape with elapsed and the naive-fidelity label', () => {
    const res = handleBacktest(store.get(), { preset: 'oversold' });
    expect(typeof res.signals).toBe('number');
    expect(typeof res.evaluated).toBe('number');
    expect(typeof res.fireRate).toBe('number');
    expect(Array.isArray(res.horizons)).toBe(true);
    for (const h of res.horizons) {
      for (const k of ['h', 'n', 'avg', 'median', 'winRate', 'best', 'worst'] as const) {
        expect(typeof h[k]).toBe('number');
      }
    }
    expect(typeof res.elapsedMs).toBe('number');
    expect(res.label).toBe(NAIVE_LABEL);
  });

  it('rejects an unknown preset as a client error', () => {
    expect(() => handleBacktest(store.get(), { preset: 'nope' })).toThrow();
  });
});

describe('SAD#2.4 backtest latency budget: full universe + history ≤ 30s', () => {
  it('completes a full-universe, full-history backtest within budget', () => {
    const t0 = performance.now();
    handleBacktest(store.get(), { preset: 'oversold' });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThanOrEqual(30_000);
  });
});

describe('reports progress (SAD#2.4)', () => {
  it('invokes the progress callback monotonically up to the universe size', () => {
    const universe = store.get();
    const seen: number[] = [];
    runBacktest(universe, OVERSOLD, ({ name, total }) => {
      expect(total).toBe(universe.length);
      seen.push(name);
    });
    expect(seen.length).toBe(universe.length);
    expect(seen[seen.length - 1]).toBe(universe.length);
    // strictly increasing — real progress, not a single fire
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });
});

describe('HTTP/JSON NDJSON endpoint (SAD#4.2 / SAD#2.4)', () => {
  let base: string;

  async function listen() {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  beforeAll(async () => {
    const s = await listen();
    base = s.url;
  });

  it('POST /backtest streams progress lines then a single result line', async () => {
    const r = await fetch(`${base}/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'oversold' }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/x-ndjson');

    const text = await r.text();
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    const progress = lines.filter((l) => l.type === 'progress');
    const results = lines.filter((l) => l.type === 'result');

    expect(progress.length).toBeGreaterThan(0);          // progress is reported
    expect(results.length).toBe(1);                      // exactly one summary payload
    expect(lines[lines.length - 1].type).toBe('result'); // result is terminal

    const result = results[0];
    expect(typeof result.signals).toBe('number');
    expect(Array.isArray(result.horizons)).toBe(true);
    expect(result.label).toBe(NAIVE_LABEL);
  });

  it('POST /backtest rejects invalid JSON with 400', async () => {
    const r = await fetch(`${base}/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(r.status).toBe(400);
  });
});
