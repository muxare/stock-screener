import { describe, it, expect } from 'vitest';
import { DEFAULT_FAN_BACKTEST_CONFIG, type FanBacktestConfig } from '../fanBacktest.ts';
import { buildStrategyExample, exampleEntries } from './example.ts';
import { newCustomStrategy, PRESET_IDS, presetById } from './presets.ts';
import type { ExitSpec, StrategyDef } from './types.ts';

const cfg = (strategy: StrategyDef, exit: Partial<ExitSpec> = {}): FanBacktestConfig => ({
  ...DEFAULT_FAN_BACKTEST_CONFIG,
  horizons: [5],
  strategy: { ...strategy, trade: { ...strategy.trade, exit: { ...strategy.trade.exit, ...exit } } },
});

describe('buildStrategyExample', () => {
  it.each(PRESET_IDS)('draws %s with one mark per step and a trade', (id) => {
    const def = presetById(id);
    const config = cfg(def);
    const ex = buildStrategyExample(config);

    expect(ex.failure).toBeNull();
    expect(exampleEntries(config)).toHaveLength(1);

    const steps = ex.marks.filter((m) => m.stepIndex != null);
    expect(steps.map((m) => m.stepIndex)).toEqual(def.steps.map((_, i) => i));
    expect(ex.checks.every((c) => c.ok)).toBe(true);
    expect(ex.marks.some((m) => m.kind === 'entry')).toBe(true);
    expect(ex.marks.some((m) => m.kind === 'exit')).toBe(true);
    expect(ex.ema18.length).toBe(ex.bars.length);
    expect(ex.macd.line.length).toBe(ex.bars.length);
  });

  it.each(PRESET_IDS)('covers %s with contiguous phases', (id) => {
    const ex = buildStrategyExample(cfg(presetById(id)));
    expect(ex.phases[0].from).toBe(0);
    expect(ex.phases[ex.phases.length - 1].to).toBe(ex.bars.length - 1);
    for (let i = 1; i < ex.phases.length; i++) {
      expect(ex.phases[i].from).toBe(ex.phases[i - 1].to + 1);
    }
  });

  it('runs the engine over real EMAs — the drawn 18 > 50 > 100 > 200 at the 50-tag entry', () => {
    const ex = buildStrategyExample(cfg(presetById('tag50')));
    const entry = ex.marks.find((m) => m.kind === 'entry');
    const i = entry!.bar;
    expect(ex.ema18[i]).toBeGreaterThan(ex.ema50[i]);
    expect(ex.ema50[i]).toBeGreaterThan(ex.ema100[i]);
    expect(ex.ema100[i]).toBeGreaterThan(ex.ema200[i]);
    // the tag bar wicks through the 50 and closes back above it
    const tag = ex.marks.find((m) => m.label.startsWith('4 '))!;
    expect(ex.bars[tag.bar].l).toBeLessThanOrEqual(ex.ema50[tag.bar]);
    expect(ex.bars[tag.bar].c).toBeGreaterThanOrEqual(ex.ema50[tag.bar]);
  });

  it('draws a hard target level and the 2.5R window band, but neither while trailing', () => {
    const hard = buildStrategyExample(cfg(presetById('tag50'), { trailEma: null, trailPivot: false, targetR: 3 }));
    expect(hard.levels.some((l) => l.label === '3R')).toBe(true);

    const win = buildStrategyExample(cfg(presetById('tag50'), { trailEma: null, trailPivot: false, targetWindow: true }));
    expect(win.bands.some((b) => /2\.5/.test(b.label))).toBe(true);
    expect(win.levels.some((l) => l.label === '2.5R')).toBe(true);

    const trail = buildStrategyExample(cfg(presetById('tag50'), { trailEma: 50 }));
    expect(trail.levels.some((l) => /R$/.test(l.label))).toBe(false);
    expect(trail.bands).toHaveLength(0);
    expect(trail.phases.some((p) => p.label === 'Trail 50-EMA')).toBe(true);
  });

  it('trails the 50-EMA out of the trade instead of running to the target', () => {
    const config = cfg(presetById('tag50'), { trailEma: 50, trailPivot: false });
    const [entry] = exampleEntries(config);
    expect(entry.trade?.exitReason).toBe('trail');
  });

  it('shows the MACD pane only when the 18–50 window is in play', () => {
    expect(buildStrategyExample(cfg(presetById('tag50'), { macdExit: false })).showMacd).toBe(false);
    expect(buildStrategyExample(cfg(presetById('tag50'), { macdExit: true })).showMacd).toBe(true);
    const guarded = presetById('tag50');
    guarded.steps.push({ id: 'macd', type: 'macd_favorable' });
    expect(buildStrategyExample(cfg(guarded)).showMacd).toBe(true);
  });

  it('draws the default custom strategy (fan up → pullback run → breakout)', () => {
    const ex = buildStrategyExample(cfg(newCustomStrategy()));
    expect(ex.failure).toBeNull();
    expect(ex.checks.map((c) => c.ok)).toEqual([true, true, true]);
  });

  it('names the step that never fired instead of drawing a trade', () => {
    const def: StrategyDef = {
      id: 'x',
      name: 'Impossible',
      steps: [
        { id: 'a', type: 'fan_onset', entry: 'match' },
        // The stack cannot appear again one bar after it appeared.
        { id: 'b', type: 'fan_onset', entry: 'match', maxWait: 1 },
      ],
      trade: presetById('onset').trade,
    };
    const ex = buildStrategyExample(cfg(def));
    expect(ex.failure).not.toBeNull();
    expect(ex.failure!.stepIndex).toBe(1);
    expect(ex.failure!.label).toMatch(/^2\./);
    expect(ex.failure!.message).toMatch(/max wait/);
    expect(ex.checks.map((c) => c.ok)).toEqual([true, false]);
    expect(ex.marks).toHaveLength(0);
  });

  it('asks for a step when the strategy has none', () => {
    const ex = buildStrategyExample(cfg({ ...newCustomStrategy(), steps: [] }));
    expect(ex.failure?.message).toMatch(/Add a step/);
    expect(ex.bars).toHaveLength(0);
  });
});
