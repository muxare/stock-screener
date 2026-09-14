import { describe, it, expect, beforeAll } from 'vitest';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { createUniverseStore } from './universe.ts';
import { runFanBacktest, parseFanBacktestBody } from './fanBacktest.ts';
import { createScreenServer } from './index.ts';
import { RequestError } from './handlers.ts';
import { presetById } from '../src/lib/strategy/presets.ts';

const store = createUniverseStore(syntheticProvider(7));

beforeAll(() => {
  store.get();
});

describe('parseFanBacktestBody', () => {
  it('defaults a missing strategy to the 50-EMA tag preset', () => {
    const cfg = parseFanBacktestBody({});
    expect(cfg.strategy.id).toBe('tag50');
    expect(cfg.strategy.trade.exit.trailEma).toBe(50);
    expect(cfg.strategy.trade.exit.breakevenAtR).toBe(1);
    expect(cfg.horizons).toEqual([5, 10, 20, 40]);
  });

  it('accepts a preset id', () => {
    const cfg = parseFanBacktestBody({ strategy: 'bunn_cont', horizons: [5, 15] });
    expect(cfg.strategy).toEqual(presetById('bunn_cont'));
    expect(cfg.horizons).toEqual([5, 15]);
  });

  it('accepts a definition object', () => {
    const def = { id: 'mine', name: 'Mine', steps: [{ id: 'a', type: 'fan_up', mode: 'slow', hold: true }], trade: { exit: { trailEma: null, targetR: 2 } } };
    const cfg = parseFanBacktestBody({ strategy: def });
    expect(cfg.strategy.id).toBe('mine');
    expect(cfg.strategy.steps[0]).toMatchObject({ type: 'fan_up', mode: 'slow', hold: true });
    expect(cfg.strategy.trade.exit.trailEma).toBeNull();
    expect(cfg.strategy.trade.exit.targetR).toBe(2);
  });

  it('rejects an unknown preset id and an invalid definition as RequestError', () => {
    expect(() => parseFanBacktestBody({ strategy: 'nope' })).toThrow(RequestError);
    expect(() => parseFanBacktestBody({ strategy: { steps: [] } })).toThrow(RequestError);
    expect(() => parseFanBacktestBody({ strategy: { steps: [{ type: 'ema_tag', hold: true }] } })).toThrow(RequestError);
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
    const res = runFanBacktest(store.get(), { strategy: presetById('onset'), horizons: [5, 10] });
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
      body: JSON.stringify({ strategy: 'onset', horizons: [5] }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('ndjson');
    const text = await r.text();
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === 'progress')).toBe(true);
    const result = lines.find((l) => l.type === 'result');
    expect(result?.totalEntries).toBeGreaterThan(0);
    expect(result?.config.strategy.id).toBe('onset');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns a JSON 400 for an invalid strategy definition', async () => {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await fetch(`http://127.0.0.1:${port}/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: { steps: [] } }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/at least one step/);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('POST /signals', () => {
  it('accepts a preset id or a definition and rejects a missing strategy', async () => {
    const server = createScreenServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/signals`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const preset = await post({ strategy: 'onset' });
    expect(preset.status).toBe(200);
    const pj = (await preset.json()) as { strategy: string; strategyName: string; rows: unknown[] };
    expect(pj.strategy).toBe('onset');
    expect(pj.strategyName).toMatch(/onset/i);
    const custom = await post({ strategy: { id: 'mine', name: 'Mine', steps: [{ id: 'a', type: 'fan_onset' }] } });
    expect(custom.status).toBe(200);
    expect(((await custom.json()) as { strategy: string }).strategy).toBe('mine');
    const missing = await post({});
    expect(missing.status).toBe(400);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
