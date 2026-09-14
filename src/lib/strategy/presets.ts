// strategy/presets.ts — the eight built-in strategies expressed as steps, plus
// the defaults a new custom strategy starts from. Ids are unchanged from the
// old fixed strategy list so saved links / URLs keep meaning the same thing.

import { BUNN_PENNY } from './primitives.ts';
import type { EntrySpec, ExitSpec, Step, StopSpec, StrategyDef, TradeSpec } from './types.ts';

export const DEFAULT_ENTRY: EntrySpec = { mode: 'buy_stop', offset: BUNN_PENNY, maxWait: null };
export const DEFAULT_STOP: StopSpec = { anchor: 'setup_low', underEma50: false, atrPad: 0.25, offset: 0 };
export const DEFAULT_EXIT: ExitSpec = {
  targetR: 3,
  targetWindow: false,
  trailEma: 50,
  trailPivot: false,
  breakevenAtR: 1,
  maxHoldBars: 20,
  macdExit: false,
  fanExit: 'slow',
};

const CLOSE_ENTRY: EntrySpec = { mode: 'close', offset: 0, maxWait: null };
const TRIGGER_STOP: StopSpec = { anchor: 'trigger_low', underEma50: true, atrPad: 0.25, offset: 0 };
const SETUP_STOP: StopSpec = { anchor: 'setup_low', underEma50: true, atrPad: 0.25, offset: 0 };
const BUNN_ENTRY: EntrySpec = { mode: 'buy_stop', offset: BUNN_PENNY, maxWait: null };

const cross: Step = { id: 'cross', type: 'ema_cross', fast: 18, slow: 50, dir: 'up', require: 'slow_fan' };

function tagSteps(tag: Step): Step[] {
  return [
    cross,
    { id: 'fan', type: 'fan_up', mode: 'full', hold: true },
    { id: 'swing', type: 'pullback', mode: 'swing', maxLowerLows: 2, rearmOnNewHigh: true },
    tag,
    { id: 'slope', type: 'ema_slope', ema: 50, lookback: 5 },
  ];
}

function trade(entry: EntrySpec, stop: StopSpec, exit: Partial<ExitSpec> = {}): TradeSpec {
  return { entry: { ...entry }, stop: { ...stop }, exit: { ...DEFAULT_EXIT, ...exit } };
}

const PRESET_LIST: StrategyDef[] = [
  {
    id: 'onset',
    name: 'Fan onset (baseline)',
    description: 'First bar the full 18>50>100>200 stack appears.',
    builtin: true,
    steps: [{ id: 'onset', type: 'fan_onset', entry: 'match' }],
    trade: trade(CLOSE_ENTRY, TRIGGER_STOP, { fanExit: 'full' }),
  },
  {
    id: 'cross',
    name: 'Continuation cross',
    description: '18 crosses up through 50 while 50>100>200 holds.',
    builtin: true,
    steps: [cross],
    trade: trade(CLOSE_ENTRY, TRIGGER_STOP),
  },
  {
    id: 'tag18',
    name: '18-EMA tag (bone zone)',
    description: 'Pullback tags the 18 and closes back above it while the stack holds.',
    builtin: true,
    steps: tagSteps({ id: 'tag', type: 'ema_tag', ema: 18, throughEma: null, confirm: 'none' }),
    trade: trade(CLOSE_ENTRY, SETUP_STOP),
  },
  {
    id: 'tag50',
    name: '50-EMA tag',
    description: 'Bounce off the 50 after the cross; 0–2 lower lows, 50 still rising, 18>50>100>200.',
    builtin: true,
    steps: tagSteps({ id: 'tag', type: 'ema_tag', ema: 50, throughEma: null, confirm: 'none' }),
    trade: trade(CLOSE_ENTRY, SETUP_STOP),
  },
  {
    id: 'structure',
    name: 'Full structure',
    description: '50-tag + reversal or rejection wick + 18-50 MACD still favorable.',
    builtin: true,
    steps: tagSteps({ id: 'tag', type: 'ema_tag', ema: 50, throughEma: null, confirm: 'reversal_or_bounce' }),
    trade: trade(CLOSE_ENTRY, SETUP_STOP),
  },
  {
    id: 'dual_ema',
    name: 'Dual-EMA test',
    description: 'Full structure that trades through both 18 and 50.',
    builtin: true,
    steps: tagSteps({ id: 'tag', type: 'ema_tag', ema: 50, throughEma: 18, confirm: 'reversal_or_bounce' }),
    trade: trade(CLOSE_ENTRY, SETUP_STOP),
  },
  {
    id: 'bunn_bounce',
    name: 'Bunn bounce',
    description: 'Fan-intact reversal on the 50, 100, or 200; buy stop 2¢ above the trigger; R = bar height + 2¢.',
    builtin: true,
    steps: [
      { id: 'fan', type: 'fan_up', mode: 'slow', hold: true },
      { id: 'reversal', type: 'reversal_candle', emas: [50, 100, 200], style: 'bunn', refresh: false },
    ],
    trade: trade(BUNN_ENTRY, { anchor: 'trigger_low', underEma50: false, atrPad: 0, offset: 0 }),
  },
  {
    id: 'bunn_cont',
    name: 'Bunn continuation',
    description: '18 adversely crosses 50, reversal bounce on 100 or 200, then buy stop 2¢ above the bar that resumes the full fan.',
    builtin: true,
    steps: [
      { id: 'adverse', type: 'ema_cross', fast: 18, slow: 50, dir: 'down', require: 'slow_fan', hold: true },
      { id: 'fan', type: 'fan_up', mode: 'slow', hold: true },
      { id: 'reversal', type: 'reversal_candle', emas: [100, 200], style: 'bunn', refresh: true },
      { id: 'resume', type: 'ema_cross', fast: 18, slow: 50, dir: 'up', require: 'full_fan' },
    ],
    trade: trade(BUNN_ENTRY, { anchor: 'mark_low', stepId: 'reversal', underEma50: false, atrPad: 0, offset: BUNN_PENNY }),
  },
];

export const PRESET_IDS: string[] = PRESET_LIST.map((p) => p.id);

export function isPresetId(id: unknown): boolean {
  return typeof id === 'string' && PRESET_IDS.includes(id);
}

export function cloneStrategy(def: StrategyDef): StrategyDef {
  return structuredClone(def);
}

/** All presets, freshly cloned so callers can edit without touching the originals. */
export function presets(): StrategyDef[] {
  return PRESET_LIST.map(cloneStrategy);
}

/** A fresh copy of a preset. Throws on an unknown id. */
export function presetById(id: string): StrategyDef {
  const p = PRESET_LIST.find((s) => s.id === id);
  if (!p) throw new Error(`unknown preset strategy "${id}"`);
  return cloneStrategy(p);
}

/** Preset first, then a saved custom strategy; null when neither matches. */
export function resolveStrategy(id: string, saved: StrategyDef[] = []): StrategyDef | null {
  if (isPresetId(id)) return presetById(id);
  const s = saved.find((d) => d.id === id);
  return s ? cloneStrategy(s) : null;
}

export function strategyNameOf(id: string, saved: StrategyDef[] = []): string {
  return PRESET_LIST.find((p) => p.id === id)?.name ?? saved.find((d) => d.id === id)?.name ?? id;
}

function newId(): string {
  const rnd = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `custom-${rnd}`;
}

/** A fresh editable strategy: fan up (held) → pullback run → breakout, with the default trade rows. */
export function newCustomStrategy(name = 'New strategy'): StrategyDef {
  return {
    id: newId(),
    name,
    steps: [
      { id: 's1', type: 'fan_up', mode: 'full', hold: true },
      { id: 's2', type: 'pullback', mode: 'run', minBars: 3, lowerHighs: true, lowerLows: true, belowEma: 18, belowField: 'low', nextBarOnly: true },
      { id: 's3', type: 'price_vs_ema', ema: 18, field: 'high', dir: 'above' },
    ],
    trade: { entry: { ...DEFAULT_ENTRY }, stop: { ...DEFAULT_STOP }, exit: { ...DEFAULT_EXIT } },
  };
}
