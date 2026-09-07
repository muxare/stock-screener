import { describe, it, expect } from 'vitest';
import { DEFAULT_FAN_BACKTEST_CONFIG, type FanBacktestConfig } from './fanBacktest.ts';
import { buildFanExample, legacyIdOf } from './fanExample.ts';
import { presetById, newCustomStrategy } from './strategy/presets.ts';
import type { ExitSpec } from './strategy/types.ts';

/** Legacy-flavoured overrides mapped onto the StrategyDef config (adapter under test). */
interface Over extends Partial<ExitSpec> {
  strategy?: string;
  macdWindow?: boolean;
  continueEpisode?: boolean;
}

const cfg = ({ strategy = 'tag50', macdWindow, continueEpisode, ...exit }: Over = {}): FanBacktestConfig => {
  const def = presetById(strategy);
  const steps = continueEpisode === undefined
    ? def.steps
    : def.steps.map((s) => (s.type === 'pullback' && s.mode === 'swing' ? { ...s, rearmOnNewHigh: continueEpisode } : s));
  return {
    ...DEFAULT_FAN_BACKTEST_CONFIG,
    strategy: {
      ...def,
      steps,
      trade: { ...def.trade, exit: { ...def.trade.exit, ...exit, ...(macdWindow === undefined ? {} : { macdExit: macdWindow }) } },
    },
  };
};

describe('legacyIdOf', () => {
  it('maps presets to themselves and a custom pullback strategy to the nearest sketch', () => {
    expect(legacyIdOf(presetById('bunn_cont'))).toBe('bunn_cont');
    expect(legacyIdOf(newCustomStrategy())).toBe('tag50');
  });
});

describe('buildFanExample', () => {
  it('covers every bar with contiguous phases for the default 50-tag', () => {
    const ex = buildFanExample(cfg());
    expect(ex.phases[0].from).toBe(0);
    expect(ex.phases[ex.phases.length - 1].to).toBe(ex.bars.length - 1);
    for (let i = 1; i < ex.phases.length; i++) {
      expect(ex.phases[i].from).toBe(ex.phases[i - 1].to + 1);
    }
    expect(ex.phases.some((p) => p.id === 'pull')).toBe(true);
    expect(ex.phases.some((p) => p.id === 'tag')).toBe(true);
    expect(ex.ema18.length).toBe(ex.bars.length);
    expect(ex.marks.some((m) => m.kind === 'entry')).toBe(true);
    expect(ex.marks.some((m) => m.kind === 'exit')).toBe(true);
  });

  it('draws onset as unstacked then the first stacked bar, with no 50-pullback', () => {
    const ex = buildFanExample(cfg({ strategy: 'onset' }));
    expect(ex.phases[0].id).toBe('unstacked');
    expect(ex.phases.some((p) => p.id === 'tag')).toBe(true);
    expect(ex.phases.some((p) => p.id === 'pull')).toBe(false);
    expect(ex.title).toMatch(/onset/i);
  });

  it('labels a Bunn continuation as adverse, bounce, then resume fill', () => {
    const ex = buildFanExample(cfg({ strategy: 'bunn_cont' }));
    expect(ex.phases.map((p) => p.id)).toEqual(
      expect.arrayContaining(['adverse', 'bounce', 'resume', 'tag']),
    );
    expect(ex.marks.some((m) => m.kind === 'adverse')).toBe(true);
    expect(ex.marks.some((m) => m.kind === 'bounce')).toBe(true);
    expect(ex.marks.some((m) => m.kind === 'resume')).toBe(true);
  });

  it('keeps a hard target level off the trail-50 schematic', () => {
    const trail = buildFanExample(cfg({ trailEma: 50, trailPivot: false, targetWindow: false }));
    expect(trail.levels.some((l) => /R$/.test(l.label))).toBe(false);
    const hard = buildFanExample(cfg({ trailEma: null, trailPivot: false, targetWindow: false, targetR: 3 }));
    expect(hard.levels.some((l) => l.label === '3R')).toBe(true);
  });

  it('shades the 2.5–3R window when that target is selected', () => {
    const ex = buildFanExample(cfg({ trailEma: null, trailPivot: false, targetWindow: true }));
    expect(ex.bands.some((b) => /2\.5/.test(b.label))).toBe(true);
    expect(ex.phases.some((p) => /2\.5R/.test(p.label))).toBe(true);
  });

  it('shows MACD only when the 18–50 window filter is on', () => {
    expect(buildFanExample(cfg({ macdWindow: false })).showMacd).toBe(false);
    expect(buildFanExample(cfg({ macdWindow: true })).showMacd).toBe(true);
  });

  it('adds a continuation pullback when re-arm is on for a 50-tag', () => {
    const on = buildFanExample(cfg({ continueEpisode: true, strategy: 'tag50' }));
    const off = buildFanExample(cfg({ continueEpisode: false, strategy: 'tag50' }));
    expect(on.phases.some((p) => p.id === 'cont_pull')).toBe(true);
    expect(off.phases.some((p) => p.id === 'cont_pull')).toBe(false);
  });

  it('does not re-arm continuation on onset or Bunn bounce', () => {
    expect(buildFanExample(cfg({ strategy: 'onset', continueEpisode: true })).phases.some((p) => p.id === 'cont_pull')).toBe(false);
    expect(buildFanExample(cfg({ strategy: 'bunn_bounce', continueEpisode: true })).phases.some((p) => p.id === 'cont_pull')).toBe(false);
  });
});
