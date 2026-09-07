// strategy/parse.ts — validate an untrusted StrategyDef (HTTP body or
// localStorage). Shared by the server and the client so both accept exactly the
// same shapes. Structural problems throw StrategyParseError; individual param
// values are coerced to their type's defaults.

import { DEFAULT_ENTRY, DEFAULT_EXIT, DEFAULT_STOP, isPresetId, presetById } from './presets.ts';
import { coerceParams, isHoldable, isStepType, stepKindOf } from './steps.ts';
import type { EntrySpec, ExitSpec, Step, StopSpec, StrategyDef } from './types.ts';

export class StrategyParseError extends Error {}

export const MAX_STEPS = 12;
export const MAX_NAME_LENGTH = 60;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, d: number, min = -Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : d;
}

function intOrNull(v: unknown, d: number | null, min: number): number | null {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v >= min) return Math.floor(v);
  return d;
}

function parseStep(raw: unknown, k: number): Step {
  const b = rec(raw);
  if (!isStepType(b.type)) throw new StrategyParseError(`step ${k + 1}: unknown type "${String(b.type)}"`);
  const type = b.type;
  const id = typeof b.id === 'string' && b.id.trim() ? b.id.trim().slice(0, 40) : `s${k + 1}`;
  const params = coerceParams(type, b);
  const step: Step = { id, ...params };
  if (b.hold === true) {
    if (!isHoldable(type)) throw new StrategyParseError(`step ${k + 1} (${type}): hold is not allowed on this step type`);
    step.hold = true;
  }
  const maxWait = intOrNull(b.maxWait, null, 0);
  if (maxWait != null) step.maxWait = maxWait;
  return step;
}

export function parseEntrySpec(raw: unknown): EntrySpec {
  const b = rec(raw);
  return {
    mode: b.mode === 'close' ? 'close' : b.mode === 'buy_stop' ? 'buy_stop' : DEFAULT_ENTRY.mode,
    offset: num(b.offset, DEFAULT_ENTRY.offset, 0),
    maxWait: intOrNull(b.maxWait, DEFAULT_ENTRY.maxWait, 0),
  };
}

export function parseStopSpec(raw: unknown, stepIds: string[]): StopSpec {
  const b = rec(raw);
  const anchor = b.anchor === 'trigger_low' || b.anchor === 'mark_low' || b.anchor === 'setup_low' ? b.anchor : DEFAULT_STOP.anchor;
  const spec: StopSpec = {
    anchor,
    underEma50: b.underEma50 === true,
    atrPad: num(b.atrPad, DEFAULT_STOP.atrPad, 0),
    offset: num(b.offset, DEFAULT_STOP.offset, 0),
  };
  if (anchor === 'mark_low') {
    if (typeof b.stepId !== 'string' || !stepIds.includes(b.stepId)) {
      throw new StrategyParseError('stop: mark_low needs the id of an existing step');
    }
    spec.stepId = b.stepId;
  }
  return spec;
}

export function parseExitSpec(raw: unknown): ExitSpec {
  const b = rec(raw);
  const trailPivot = b.trailPivot === true;
  return {
    targetR: typeof b.targetR === 'number' && b.targetR > 0 ? b.targetR : DEFAULT_EXIT.targetR,
    targetWindow: trailPivot ? false : b.targetWindow === true,
    trailEma: trailPivot
      ? null
      : b.trailEma === 18 || b.trailEma === 50
        ? b.trailEma
        : b.trailEma === null
          ? null
          : DEFAULT_EXIT.trailEma,
    trailPivot,
    breakevenAtR: b.breakevenAtR === null ? null : typeof b.breakevenAtR === 'number' && b.breakevenAtR > 0 ? b.breakevenAtR : DEFAULT_EXIT.breakevenAtR,
    maxHoldBars: b.maxHoldBars === null ? null : typeof b.maxHoldBars === 'number' && b.maxHoldBars > 0 ? Math.floor(b.maxHoldBars) : DEFAULT_EXIT.maxHoldBars,
    macdExit: b.macdExit === true,
    fanExit: b.fanExit === 'full' ? 'full' : 'slow',
  };
}

/** Validate a strategy definition. Throws StrategyParseError on structural problems. */
export function parseStrategyDef(raw: unknown): StrategyDef {
  const b = rec(raw);
  if (!Array.isArray(b.steps) || b.steps.length === 0) throw new StrategyParseError('strategy needs at least one step');
  if (b.steps.length > MAX_STEPS) throw new StrategyParseError(`strategy has more than ${MAX_STEPS} steps`);
  const steps = b.steps.map(parseStep);
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) throw new StrategyParseError(`duplicate step id "${s.id}"`);
    ids.add(s.id);
  }
  if (steps.filter((s) => stepKindOf(s) === 'tracker').length > 1) {
    throw new StrategyParseError('at most one swing pullback (tracker) step is allowed');
  }
  const id = typeof b.id === 'string' && b.id.trim() ? b.id.trim().slice(0, 80) : 'custom';
  const nameRaw = typeof b.name === 'string' ? b.name.trim() : '';
  if (nameRaw.length > MAX_NAME_LENGTH) throw new StrategyParseError(`name is longer than ${MAX_NAME_LENGTH} characters`);
  const t = rec(b.trade);
  const def: StrategyDef = {
    id,
    name: nameRaw || id,
    steps,
    trade: {
      entry: parseEntrySpec(t.entry),
      stop: parseStopSpec(t.stop, steps.map((s) => s.id)),
      exit: parseExitSpec(t.exit),
    },
  };
  if (typeof b.description === 'string' && b.description.trim()) def.description = b.description.trim().slice(0, 300);
  if (b.builtin === true) def.builtin = true;
  return def;
}

/** A preset id string or a full definition object. */
export function parseStrategyRef(raw: unknown): StrategyDef {
  if (typeof raw === 'string') {
    if (!isPresetId(raw)) throw new StrategyParseError(`unknown strategy "${raw}"`);
    return presetById(raw);
  }
  if (raw && typeof raw === 'object') return parseStrategyDef(raw);
  throw new StrategyParseError('strategy must be a preset id or a definition object');
}
