import { describe, it, expect } from 'vitest';
import { parseStrategyDef, parseStrategyRef, StrategyParseError } from './parse.ts';
import { presets, presetById, PRESET_IDS } from './presets.ts';
import { describeStrategy } from './steps.ts';

describe('parseStrategyDef', () => {
  it('round-trips every preset', () => {
    for (const p of presets()) {
      expect(parseStrategyDef(JSON.parse(JSON.stringify(p)))).toEqual(p);
    }
  });

  it('rejects an unknown step type', () => {
    expect(() => parseStrategyDef({ steps: [{ id: 'a', type: 'moon_phase' }] })).toThrow(StrategyParseError);
  });

  it('rejects duplicate step ids', () => {
    expect(() => parseStrategyDef({ steps: [{ id: 'a', type: 'fan_up' }, { id: 'a', type: 'ema_tag' }] })).toThrow(/duplicate/);
  });

  it('rejects hold on a non-holdable step', () => {
    expect(() => parseStrategyDef({ steps: [{ id: 'a', type: 'ema_tag', hold: true }] })).toThrow(/hold/);
  });

  it('rejects a mark_low stop without an existing step id', () => {
    expect(() => parseStrategyDef({
      steps: [{ id: 'a', type: 'fan_up' }],
      trade: { stop: { anchor: 'mark_low', stepId: 'zzz' } },
    })).toThrow(/mark_low/);
  });

  it('rejects more than 12 steps and an empty strategy', () => {
    const steps = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, type: 'fan_up' }));
    expect(() => parseStrategyDef({ steps })).toThrow(/12/);
    expect(() => parseStrategyDef({ steps: [] })).toThrow(/at least one/);
  });

  it('rejects two tracker steps', () => {
    expect(() => parseStrategyDef({ steps: [
      { id: 'a', type: 'pullback', mode: 'swing' }, { id: 'b', type: 'pullback', mode: 'swing' },
    ] })).toThrow(/tracker/);
  });

  it('coerces invalid params to defaults and fills missing ids and trade rows', () => {
    const def = parseStrategyDef({
      name: 'Mine',
      steps: [
        { type: 'fan_up', mode: 'sideways', hold: true },
        { type: 'pullback', mode: 'run', minBars: 99, belowEma: 7 },
        { type: 'reversal_candle', emas: [50, 999, 50] },
      ],
    });
    expect(def.id).toBe('custom');
    expect(def.name).toBe('Mine');
    expect(def.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(def.steps[0]).toMatchObject({ type: 'fan_up', mode: 'full', hold: true });
    expect(def.steps[1]).toMatchObject({ type: 'pullback', mode: 'run', minBars: 20, belowEma: 18 });
    expect(def.steps[2]).toMatchObject({ type: 'reversal_candle', emas: [50] });
    expect(def.trade.entry.mode).toBe('buy_stop');
    expect(def.trade.stop.anchor).toBe('setup_low');
    expect(def.trade.exit.trailEma).toBe(50);
  });

  it('parses trade rows with the same rules as the old body parser', () => {
    const def = parseStrategyDef({
      steps: [{ id: 'a', type: 'fan_up' }],
      trade: {
        entry: { mode: 'close', maxWait: 3 },
        stop: { anchor: 'trigger_low', underEma50: true, atrPad: 0.5 },
        exit: { trailPivot: true, trailEma: 50, targetWindow: true, breakevenAtR: null, maxHoldBars: null, macdExit: true, fanExit: 'full' },
      },
    });
    expect(def.trade.entry).toEqual({ mode: 'close', offset: 0.02, maxWait: 3 });
    expect(def.trade.stop).toEqual({ anchor: 'trigger_low', underEma50: true, atrPad: 0.5, offset: 0 });
    expect(def.trade.exit).toMatchObject({ trailPivot: true, trailEma: null, targetWindow: false, breakevenAtR: null, maxHoldBars: null, macdExit: true, fanExit: 'full' });
  });

  it('rejects a name over 60 characters', () => {
    expect(() => parseStrategyDef({ name: 'x'.repeat(61), steps: [{ id: 'a', type: 'fan_up' }] })).toThrow(/name/);
  });
});

describe('parseStrategyRef', () => {
  it('accepts a preset id string', () => {
    expect(parseStrategyRef('onset')).toEqual(presetById('onset'));
    expect(PRESET_IDS).toContain('bunn_cont');
  });

  it('rejects an unknown id and a non-object', () => {
    expect(() => parseStrategyRef('nope')).toThrow(StrategyParseError);
    expect(() => parseStrategyRef(42)).toThrow(StrategyParseError);
  });

  it('accepts a definition object', () => {
    const def = parseStrategyRef({ id: 'mine', name: 'Mine', steps: [{ id: 'a', type: 'fan_up' }] });
    expect(def.id).toBe('mine');
  });
});

describe('describeStrategy', () => {
  it('names the EMAs and the entry rule', () => {
    expect(describeStrategy(presetById('tag50'))).toMatch(/50-EMA/);
    expect(describeStrategy(presetById('bunn_bounce'))).toMatch(/50, 100, or 200/);
    expect(describeStrategy(presetById('bunn_bounce'))).toMatch(/buy stop/);
    expect(describeStrategy(presetById('bunn_cont'))).toMatch(/adversely crossed/);
  });
});
