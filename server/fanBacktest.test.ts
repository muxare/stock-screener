import { describe, it, expect, beforeAll } from 'vitest';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { createUniverseStore } from './universe.ts';
import { runFanBacktest, parseFanBacktestBody } from './fanBacktest.ts';
import { createScreenServer } from './index.ts';

const store = createUniverseStore(syntheticProvider(7));

beforeAll(() => {
  store.get();
});

describe('parseFanBacktestBody', () => {
  it('defaults missing fields to 50-EMA tag + trail 50', () => {
    const cfg = parseFanBacktestBody({});
    expect(cfg.strategy).toBe('tag50');
    expect(cfg.targetR).toBe(3);
    expect(cfg.macdWindow).toBe(false);
    expect(cfg.continueEpisode).toBe(true);
    expect(cfg.breakevenAtR).toBe(1);
    expect(cfg.trailEma).toBe(50);
    expect(cfg.targetWindow).toBe(false);
    expect(cfg.trailPivot).toBeFalsy();
  });

  it('accepts an explicit hard target that turns the trail off', () => {
    const cfg = parseFanBacktestBody({ strategy: 'structure', trailEma: null, macdWindow: true, targetR: 3 });
    expect(cfg.strategy).toBe('structure');
    expect(cfg.trailEma).toBeNull();
    expect(cfg.macdWindow).toBe(true);
  });

  it('accepts tag18 and a 50-EMA trail', () => {
    const cfg = parseFanBacktestBody({ strategy: 'tag18', trailEma: 50, breakevenAtR: 1 });
    expect(cfg.strategy).toBe('tag18');
    expect(cfg.trailEma).toBe(50);
    expect(cfg.breakevenAtR).toBe(1);
  });

  it('accepts bunn_bounce without changing the default trail', () => {
    const cfg = parseFanBacktestBody({ strategy: 'bunn_bounce' });
    expect(cfg.strategy).toBe('bunn_bounce');
    expect(cfg.trailEma).toBe(50);
  });

  it('accepts bunn_cont', () => {
    const cfg = parseFanBacktestBody({ strategy: 'bunn_cont' });
    expect(cfg.strategy).toBe('bunn_cont');
    expect(cfg.trailEma).toBe(50);
  });

  it('accepts the 2.5–3R target window and turns the trail off', () => {
    const cfg = parseFanBacktestBody({ trailEma: null, targetWindow: true });
    expect(cfg.targetWindow).toBe(true);
    expect(cfg.trailEma).toBeNull();
  });

  it('accepts trailPivot and turns the EMA trail off', () => {
    const cfg = parseFanBacktestBody({ trailPivot: true });
    expect(cfg.trailPivot).toBe(true);
    expect(cfg.trailEma).toBeNull();
    expect(cfg.targetWindow).toBe(false);
  });

  it('maps legacy entry=match to onset and accepts custom horizons', () => {
    const cfg = parseFanBacktestBody({ entry: 'match', horizons: [5, 15], macdWindow: false });
    expect(cfg.strategy).toBe('onset');
    expect(cfg.horizons).toEqual([5, 15]);
    expect(cfg.macdWindow).toBe(false);
  });

  it('forwards volume and market-cap floors', () => {
    const cfg = parseFanBacktestBody({ minAvgVol: 250_000, minMarketCap: 1e9 });
    expect(cfg.minAvgVol).toBe(250_000);
    expect(cfg.minMarketCap).toBe(1e9);
  });

  it('defaults the 200-EMA rising lookback to 1 month and accepts 0 / 63 / 105', () => {
    expect(parseFanBacktestBody({}).ema200RisingBars).toBe(21);
    expect(parseFanBacktestBody({ ema200RisingBars: 0 }).ema200RisingBars).toBe(0);
    expect(parseFanBacktestBody({ ema200RisingBars: 105 }).ema200RisingBars).toBe(105);
  });

  it('forwards swing-account cash, risk, slots, and window', () => {
    const cfg = parseFanBacktestBody({ startCash: 25_000, riskPct: 2, maxPositions: 6, windowMonths: 2 });
    expect(cfg.startCash).toBe(25_000);
    expect(cfg.riskPct).toBe(2);
    expect(cfg.maxPositions).toBe(6);
    expect(cfg.windowMonths).toBe(2);
  });

  it('defaults missing account fields to 10k / 1% / 4 names / 3 months', () => {
    const cfg = parseFanBacktestBody({});
    expect(cfg.startCash).toBe(10_000);
    expect(cfg.riskPct).toBe(1);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.windowMonths).toBe(3);
  });
});

describe('runFanBacktest', () => {
  it('returns entries and trade summary for synthetic universe (onset baseline)', () => {
    const res = runFanBacktest(store.get(), {
      strategy: 'onset', entry: 'match', targetR: 3, macdWindow: false, maxHoldBars: 60, horizons: [5, 10],
    });
    expect(res.universe).toBe(44);
    expect(res.totalEntries).toBeGreaterThan(0);
    expect(res.forwardHorizons.length).toBe(2);
    expect(res.trades.count).toBeGreaterThan(0);
  });
});

describe('POST /backtest NDJSON', () => {
  it('streams progress then result', async () => {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: 'onset', macdWindow: false, horizons: [5] }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('ndjson');
    const text = await r.text();
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === 'progress')).toBe(true);
    const result = lines.find((l) => l.type === 'result');
    expect(result?.totalEntries).toBeGreaterThan(0);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
