import { useMemo, useState } from 'react';
import { useScreener } from '../../store';
import { HButton } from '../ui/Hoverable';
import {
  MAX_STEPS,
  StrategyParseError,
  parseStrategyDef,
} from '../../lib/strategy/parse';
import {
  cloneStrategy,
  isPresetId,
  newCustomStrategy,
  presetById,
  presets,
  resolveStrategy,
} from '../../lib/strategy/presets';
import {
  STEP_TYPE_IDS,
  coerceParams,
  defaultParams,
  describeStep,
  isHoldable,
  paramSchema,
  stepKindOf,
  stepTypeOf,
  type ParamField,
} from '../../lib/strategy/steps';
import type {
  EntrySpec,
  Step,
  StepKind,
  StepType,
  StopSpec,
  StrategyDef,
} from '../../lib/strategy/types';
import { stepKindTopic, stepTopic } from '../../help/glossary';

const label: React.CSSProperties = {
  fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em',
  marginBottom: 6, fontWeight: 700, display: 'block',
};
const sub: React.CSSProperties = {
  fontSize: 10, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.05em',
  fontWeight: 700, display: 'block', marginBottom: 3,
};
const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e7e8ea',
  borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fafbfb', outline: 'none',
};
const small: React.CSSProperties = { ...field, padding: '6px 8px', fontSize: 12.5, borderRadius: 8 };
const card: React.CSSProperties = {
  background: '#fafbfb', border: '1px solid #eef0f1', borderRadius: 10, padding: '12px 14px',
};
const check: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#5b6168' };
const iconBtn: React.CSSProperties = {
  border: '1px solid #e7e8ea', background: '#fff', borderRadius: 7, width: 26, height: 26,
  fontSize: 12, lineHeight: 1, color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit', padding: 0,
};
const actionBtn: React.CSSProperties = {
  padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: 8, background: '#fff',
  fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: '#5b6168',
};

/** Same palette the example chart and the trade review use for a step's mark. */
const KIND_COLOR: Record<StepKind, string> = {
  candle: '#c47a14',
  instant: '#7c5cbf',
  tracker: '#0f9d8f',
  guard: '#8b9298',
};
const KIND_HINT: Record<StepKind, string> = {
  candle: 'Consumes a bar — at most one candle step fires per bar.',
  instant: 'Fires on the same bar as the previous step once it is true.',
  tracker: 'Fires immediately and then tracks the swing high and its lower lows.',
  guard: 'Must be true on the bar the previous step fired, otherwise that firing is cancelled.',
};

const PRESETS = presets();

/** Key-order-insensitive comparison, so a rebuilt step still equals its source. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => equal(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined && k !== 'builtin');
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined && k !== 'builtin');
  return ka.length === kb.length && ka.every((k) => equal(ra[k], rb[k]));
}

/** A pullback run with "next bar only" pins the following step to the very next bar. */
function pinsNextBar(prev: Step | undefined): boolean {
  return prev != null && prev.type === 'pullback' && prev.mode === 'run' && prev.nextBarOnly === true;
}

function freshStepId(steps: Step[]): string {
  const ids = new Set(steps.map((s) => s.id));
  for (let k = steps.length + 1; ; k++) {
    const id = `s${k}`;
    if (!ids.has(id)) return id;
  }
}

/** Rebuild a step around new params, keeping its id and the modifiers the type still allows. */
function rebuild(step: Step, type: StepType, raw: Record<string, unknown>): Step {
  const next: Step = { id: step.id, ...coerceParams(type, raw) };
  if (step.hold === true && isHoldable(type)) next.hold = true;
  if (typeof step.maxWait === 'number') next.maxWait = step.maxWait;
  return next;
}

function ParamControl({ spec, value, disabled, onChange }: {
  spec: ParamField;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  if (spec.kind === 'boolean') {
    return (
      <label style={{ ...check, paddingTop: 14 }}>
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {spec.label}
      </label>
    );
  }
  if (spec.kind === 'ema_set') {
    const picked = Array.isArray(value) ? (value as number[]) : [];
    return (
      <div>
        <span style={sub}>{spec.label}</span>
        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          {spec.options.map((o) => (
            <label key={o.value} style={check}>
              <input
                type="checkbox"
                checked={picked.includes(o.value)}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked
                  ? [...picked, o.value].sort((x, y) => x - y)
                  : picked.filter((v) => v !== o.value))}
              />
              {o.label}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (spec.kind === 'number') {
    return (
      <label style={{ display: 'block' }}>
        <span style={sub}>{spec.label}</span>
        <input
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          min={spec.min}
          max={spec.max}
          step={spec.integer ? 1 : 0.05}
          disabled={disabled}
          style={small}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(v)) onChange(v);
          }}
        />
      </label>
    );
  }
  const at = spec.options.findIndex((o) => o.value === value);
  return (
    <label style={{ display: 'block' }}>
      <span style={sub}>{spec.label}</span>
      <select
        value={at < 0 ? '' : String(at)}
        disabled={disabled}
        style={small}
        onChange={(e) => onChange(spec.options[Number(e.target.value)]?.value)}
      >
        {at < 0 && <option value="">—</option>}
        {spec.options.map((o, k) => (
          <option key={`${String(o.value)}-${k}`} value={String(k)}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function StepCard({ step, index, count, disabled, forcedMaxWait, onChange, onMove, onRemove }: {
  step: Step;
  index: number;
  count: number;
  disabled: boolean;
  /** The previous step pins this one to the next bar (pullback run, "next bar only"). */
  forcedMaxWait: boolean;
  onChange: (next: Step) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const kind = stepKindOf(step);
  const t = stepTypeOf(step.type);
  const raw = step as unknown as Record<string, unknown>;
  return (
    <div style={{ ...card, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          data-help={stepKindTopic(kind)}
          title={KIND_HINT[kind]}
          style={{
            fontSize: 10, fontWeight: 700, color: '#fff', background: KIND_COLOR[kind],
            borderRadius: 999, padding: '2px 7px', letterSpacing: '0.04em', flexShrink: 0,
          }}
        >
          {index + 1} · {kind}
        </span>
        <select
          data-help={stepTopic(step.type)}
          value={step.type}
          disabled={disabled}
          style={{ ...small, flex: 1, minWidth: 0, fontWeight: 600 }}
          onChange={(e) => onChange(rebuild(step, e.target.value as StepType, defaultParams(e.target.value as StepType) as unknown as Record<string, unknown>))}
        >
          {STEP_TYPE_IDS.map((id) => (
            <option key={id} value={id}>{stepTypeOf(id).label}</option>
          ))}
        </select>
        <HButton type="button" title="Move up" disabled={disabled || index === 0} onClick={() => onMove(-1)} style={iconBtn} hoverStyle={{ background: '#f2f3f4' }}>↑</HButton>
        <HButton type="button" title="Move down" disabled={disabled || index === count - 1} onClick={() => onMove(1)} style={iconBtn} hoverStyle={{ background: '#f2f3f4' }}>↓</HButton>
        <HButton type="button" title="Remove step" disabled={disabled} onClick={onRemove} style={iconBtn} hoverStyle={{ background: '#fdeceb', color: '#b3261a' }}>✕</HButton>
      </div>

      {paramSchema(step).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
          {paramSchema(step).map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={raw[spec.key]}
              disabled={disabled}
              onChange={(v) => onChange(rebuild(step, step.type, { ...raw, [spec.key]: v }))}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        <label data-help="hold" style={check} title={t.holdable
          ? 'Once fired, this must stay true; when it breaks the machine resets to step 1.'
          : 'This step type cannot be held.'}>
          <input
            type="checkbox"
            checked={step.hold === true}
            disabled={disabled || !t.holdable}
            onChange={(e) => onChange(e.target.checked ? { ...step, hold: true } : { ...step, hold: undefined })}
          />
          Hold as an invariant
        </label>
        <label data-help="max-wait" style={{ ...check, gap: 6 }} title="Bars this step may wait after the previous one fired. Blank = forever.">
          Max wait
          <input
            type="number"
            min={0}
            value={forcedMaxWait ? 1 : typeof step.maxWait === 'number' ? String(step.maxWait) : ''}
            placeholder="—"
            disabled={disabled || forcedMaxWait}
            style={{ ...small, width: 72 }}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange({ ...step, maxWait: e.target.value === '' || !Number.isFinite(v) ? undefined : Math.max(0, Math.floor(v)) });
            }}
          />
          {forcedMaxWait && <span style={{ fontSize: 11, color: '#98a0a8' }}>next bar only</span>}
        </label>
      </div>

      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8, lineHeight: 1.4 }}>{describeStep(step)}</div>
    </div>
  );
}

export function StrategyBuilder({ def, disabled }: { def: StrategyDef; disabled: boolean }) {
  const setDef = useScreener((s) => s.setStrategyDef);
  const patchExit = useScreener((s) => s.patchExit);
  const strategies = useScreener((s) => s.strategies);
  const saveStrategy = useScreener((s) => s.saveStrategy);
  const deleteStrategy = useScreener((s) => s.deleteStrategy);
  const [addType, setAddType] = useState<StepType>('ema_tag');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const savedEntry = strategies.find((d) => d.id === def.id) ?? null;
  const isPreset = isPresetId(def.id);
  const source = useMemo(
    () => (isPresetId(def.id) ? presetById(def.id) : strategies.find((d) => d.id === def.id) ?? null),
    [def.id, strategies],
  );
  const dirty = !source || !equal(def, source);
  const error = useMemo(() => {
    try {
      parseStrategyDef(def);
      return null;
    } catch (e) {
      return e instanceof StrategyParseError ? e.message : 'This strategy is not valid.';
    }
  }, [def]);

  const exit = def.trade.exit;
  const entry = def.trade.entry;
  const stop = def.trade.stop;

  const update = (patch: Partial<StrategyDef>) => setDef({ ...def, ...patch });
  const patchEntry = (p: Partial<EntrySpec>) => update({ trade: { ...def.trade, entry: { ...entry, ...p } } });
  const patchStop = (p: Partial<StopSpec>) => update({ trade: { ...def.trade, stop: { ...stop, ...p } } });
  const setSteps = (steps: Step[]) => update({ steps });

  function pick(id: string) {
    if (id === '__new') {
      setDef(newCustomStrategy());
      return;
    }
    const next = resolveStrategy(id, strategies);
    if (!next) return;
    // A preset brings its steps, entry and stop but keeps the exit management
    // the user has dialled in; a saved strategy is loaded exactly as saved.
    setDef(next.builtin
      ? { ...next, trade: { ...next.trade, exit: { ...exit, fanExit: next.trade.exit.fanExit } } }
      : next);
    setConfirmDelete(false);
  }

  function removeStep(i: number) {
    const gone = def.steps[i];
    const steps = def.steps.filter((_, k) => k !== i);
    // The stop can no longer anchor on a step that is gone.
    const trade = stop.anchor === 'mark_low' && stop.stepId === gone.id
      ? { ...def.trade, stop: { ...stop, anchor: 'setup_low' as const, stepId: undefined } }
      : def.trade;
    update({ steps, trade });
  }

  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= def.steps.length) return;
    const steps = [...def.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setSteps(steps);
  }

  function saveAs() {
    const copy: StrategyDef = { ...cloneStrategy(def), id: newCustomStrategy().id };
    delete copy.builtin;
    if (source && copy.name === source.name) copy.name = `${copy.name} copy`.slice(0, 60);
    saveStrategy(copy);
    setDef(copy);
  }

  function save() {
    const clean = cloneStrategy(def);
    delete clean.builtin;
    saveStrategy(clean);
    setDef(clean);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
        <div>
          <label data-help="strategy" style={label}>Strategy</label>
          <select
            value={isPreset || savedEntry ? def.id : '__unsaved'}
            disabled={disabled}
            onChange={(e) => pick(e.target.value)}
            style={field}
          >
            <optgroup label="Built-in presets">
              {PRESETS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
            {strategies.length > 0 && (
              <optgroup label="Saved">
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            )}
            {!isPreset && !savedEntry && <option value="__unsaved">{def.name} (unsaved)</option>}
            <optgroup label="—">
              <option value="__new">New strategy…</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label style={label}>Name</label>
          <input
            value={def.name}
            maxLength={60}
            disabled={disabled}
            onChange={(e) => update({ name: e.target.value })}
            style={field}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <HButton
          type="button"
          onClick={save}
          disabled={disabled || isPreset || !!error || (!dirty && !!savedEntry)}
          title={isPreset ? 'Presets cannot be overwritten — use Save as' : 'Save this strategy'}
          style={{ ...actionBtn, color: isPreset || !!error ? '#c4c8cc' : '#5b6168' }}
          hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
        >
          Save
        </HButton>
        <HButton
          type="button"
          onClick={saveAs}
          disabled={disabled || !!error}
          title="Save a copy under a new name"
          style={actionBtn}
          hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
        >
          Save as
        </HButton>
        <HButton
          type="button"
          onClick={() => { setDef(cloneStrategy(source!)); setConfirmDelete(false); }}
          disabled={disabled || !source || !dirty}
          title={isPreset ? 'Discard the edits and reload the preset' : 'Discard the edits and reload the saved strategy'}
          style={actionBtn}
          hoverStyle={{ background: '#f7f8f8' }}
        >
          Reset
        </HButton>
        <HButton
          type="button"
          onClick={() => {
            if (!savedEntry) return;
            if (!confirmDelete) { setConfirmDelete(true); return; }
            setConfirmDelete(false);
            deleteStrategy(savedEntry.id);
            setDef(presetById('tag50'));
          }}
          disabled={disabled || !savedEntry}
          title="Delete this saved strategy"
          style={{ ...actionBtn, color: confirmDelete ? '#b3261a' : '#5b6168', borderColor: confirmDelete ? '#f5c6c0' : '#e7e8ea' }}
          hoverStyle={{ background: '#fdeceb', color: '#b3261a' }}
        >
          {confirmDelete ? 'Delete — click again' : 'Delete'}
        </HButton>
        {dirty && (
          <span style={{ fontSize: 11.5, color: '#c47a14', fontWeight: 600 }}>
            {isPreset ? 'edited preset — save it under a new name to keep it' : savedEntry ? 'unsaved edits' : 'not saved yet'}
          </span>
        )}
      </div>

      {def.description && <div style={{ fontSize: 12.5, color: '#6b7280' }}>{def.description}</div>}

      {error && (
        <div role="alert" style={{ padding: '9px 11px', background: '#fdeceb', border: '1px solid #f5c6c0', borderRadius: 8, fontSize: 12.5, color: '#b3261a' }}>
          {error}
        </div>
      )}

      <div>
        <div data-help="step" style={{ ...label, marginBottom: 8 }}>Steps ({def.steps.length} / {MAX_STEPS})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {def.steps.map((s, i) => (
            <StepCard
              key={s.id}
              step={s}
              index={i}
              count={def.steps.length}
              disabled={disabled}
              forcedMaxWait={pinsNextBar(def.steps[i - 1])}
              onChange={(next) => setSteps(def.steps.map((old, k) => (k === i ? next : old)))}
              onMove={(dir) => moveStep(i, dir)}
              onRemove={() => removeStep(i)}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select
            data-help={stepTopic(addType)}
            value={addType}
            disabled={disabled || def.steps.length >= MAX_STEPS}
            onChange={(e) => setAddType(e.target.value as StepType)}
            style={{ ...small, flex: 1, minWidth: 0 }}
          >
            {STEP_TYPE_IDS.map((id) => (
              <option key={id} value={id}>{stepTypeOf(id).label}</option>
            ))}
          </select>
          <HButton
            type="button"
            onClick={() => setSteps([...def.steps, { id: freshStepId(def.steps), ...defaultParams(addType) }])}
            disabled={disabled || def.steps.length >= MAX_STEPS}
            style={{ ...actionBtn, whiteSpace: 'nowrap' }}
            hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
          >
            Add step
          </HButton>
        </div>
      </div>

      <div>
        <div data-help="entry" style={{ ...label, marginBottom: 8 }}>Entry</div>
        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <label data-help={entry.mode === 'buy_stop' ? 'buy-stop' : 'entry'} style={{ display: 'block' }}>
            <span style={sub}>Fill</span>
            <select
              value={entry.mode}
              disabled={disabled}
              style={small}
              onChange={(e) => patchEntry({ mode: e.target.value === 'close' ? 'close' : 'buy_stop' })}
            >
              <option value="buy_stop">Buy stop above the trigger high</option>
              <option value="close">Buy the trigger close</option>
            </select>
          </label>
          {entry.mode === 'buy_stop' && (
            <>
              <label data-help="buy-stop" style={{ display: 'block' }}>
                <span style={sub}>Offset above the high</span>
                <input
                  type="number" min={0} step={0.01} value={String(entry.offset)} disabled={disabled} style={small}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) patchEntry({ offset: v }); }}
                />
              </label>
              <label data-help="buy-stop" style={{ display: 'block' }} title="Bars the resting buy stop may wait for a fill. Blank = until a held step breaks.">
                <span style={sub}>Max wait (bars)</span>
                <input
                  type="number" min={0} placeholder="—" value={entry.maxWait == null ? '' : String(entry.maxWait)} disabled={disabled} style={small}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    patchEntry({ maxWait: e.target.value === '' || !Number.isFinite(v) ? null : Math.max(0, Math.floor(v)) });
                  }}
                />
              </label>
            </>
          )}
        </div>
      </div>

      <div>
        <div data-help="stop" style={{ ...label, marginBottom: 8 }}>Stop</div>
        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <label data-help="stop-anchor" style={{ display: 'block' }}>
            <span style={sub}>Anchor</span>
            <select
              value={stop.anchor}
              disabled={disabled}
              style={small}
              onChange={(e) => {
                const anchor = e.target.value as StopSpec['anchor'];
                patchStop(anchor === 'mark_low'
                  ? { anchor, stepId: stop.stepId && def.steps.some((s) => s.id === stop.stepId) ? stop.stepId : def.steps[def.steps.length - 1]?.id }
                  : { anchor, stepId: undefined });
              }}
            >
              <option value="setup_low">Lowest low of the setup</option>
              <option value="trigger_low">The trigger bar's low</option>
              <option value="mark_low">The low of a step's bar</option>
            </select>
          </label>
          {stop.anchor === 'mark_low' && (
            <label data-help="stop-anchor" style={{ display: 'block' }}>
              <span style={sub}>Step</span>
              <select
                value={stop.stepId ?? ''}
                disabled={disabled}
                style={small}
                onChange={(e) => patchStop({ stepId: e.target.value })}
              >
                {stop.stepId && !def.steps.some((s) => s.id === stop.stepId) && <option value={stop.stepId}>{stop.stepId} (missing)</option>}
                {def.steps.map((s, i) => (
                  <option key={s.id} value={s.id}>{i + 1} · {stepTypeOf(s.type).label}</option>
                ))}
              </select>
            </label>
          )}
          <label data-help="atr" style={{ display: 'block' }} title="ATR(14) fraction padded under the anchor.">
            <span style={sub}>ATR pad</span>
            <input
              type="number" min={0} step={0.05} value={String(stop.atrPad)} disabled={disabled} style={small}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) patchStop({ atrPad: v }); }}
            />
          </label>
          <label data-help="stop" style={{ display: 'block' }}>
            <span style={sub}>Extra offset</span>
            <input
              type="number" min={0} step={0.01} value={String(stop.offset)} disabled={disabled} style={small}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) patchStop({ offset: v }); }}
            />
          </label>
          <label data-help="stop-anchor" style={{ ...check, paddingTop: 14 }} title="Also push the stop under the 50-EMA at the fill.">
            <input type="checkbox" checked={stop.underEma50} disabled={disabled} onChange={(e) => patchStop({ underEma50: e.target.checked })} />
            Also under the 50-EMA
          </label>
        </div>
      </div>

      <div>
        <div data-help="exit" style={{ ...label, marginBottom: 8 }}>Exit</div>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <label data-help={exit.trailPivot ? 'trail-pivot' : exit.trailEma ? 'trail-ema' : exit.targetWindow ? 'target-window' : 'target'} style={{ display: 'block' }}>
              <span style={sub}>Target</span>
              <select
                value={
                  exit.trailPivot ? 'pivot'
                    : exit.targetWindow ? 'window'
                      : exit.trailEma === 50 ? 'trail50'
                        : exit.trailEma === 18 ? 'trail18'
                          : String(exit.targetR)
                }
                disabled={disabled}
                style={small}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'trail50') patchExit({ trailPivot: false, targetWindow: false, trailEma: 50 });
                  else if (v === 'trail18') patchExit({ trailPivot: false, targetWindow: false, trailEma: 18 });
                  else if (v === 'window') patchExit({ trailPivot: false, trailEma: null, targetWindow: true });
                  else if (v === 'pivot') patchExit({ trailEma: null, targetWindow: false, trailPivot: true });
                  else patchExit({ trailPivot: false, targetWindow: false, trailEma: null, targetR: Number(v) });
                }}
              >
                <option value="2">2R</option>
                <option value="3">3R</option>
                <option value="4">4R</option>
                <option value="window">2.5–3R window</option>
                <option value="trail50">Trail 50-EMA</option>
                <option value="trail18">Trail 18-EMA</option>
                <option value="pivot">Trail pivots</option>
              </select>
            </label>
            <label data-help="max-hold" style={{ display: 'block' }}>
              <span style={sub}>Max hold</span>
              <select
                value={exit.maxHoldBars == null ? '' : String(exit.maxHoldBars)}
                disabled={disabled}
                style={small}
                onChange={(e) => patchExit({ maxHoldBars: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="10">10 bars</option>
                <option value="15">15 bars</option>
                <option value="20">20 bars</option>
                <option value="40">40 bars</option>
                <option value="">Until exit</option>
              </select>
            </label>
            <label data-help="fan-exit" style={{ display: 'block' }} title="Flatten when this stack breaks.">
              <span style={sub}>Fan exit</span>
              <select
                value={exit.fanExit}
                disabled={disabled}
                style={small}
                onChange={(e) => patchExit({ fanExit: e.target.value === 'full' ? 'full' : 'slow' })}
              >
                <option value="slow">50 &gt; 100 &gt; 200 breaks</option>
                <option value="full">18 &gt; 50 &gt; 100 &gt; 200 breaks</option>
              </select>
            </label>
          </div>
          <label data-help="breakeven" style={check}>
            <input
              type="checkbox"
              checked={exit.breakevenAtR != null && exit.breakevenAtR > 0}
              disabled={disabled}
              onChange={(e) => patchExit({ breakevenAtR: e.target.checked ? 1 : null })}
            />
            Move stop to breakeven at 1R
          </label>
          <label data-help="macd-exit" style={check}>
            <input
              type="checkbox"
              checked={exit.macdExit}
              disabled={disabled}
              onChange={(e) => patchExit({ macdExit: e.target.checked })}
            />
            {exit.trailEma || exit.trailPivot
              ? 'Exit on an 18–50 MACD flip (ignored while trailing)'
              : 'Exit when the 18–50 MACD line drops below its signal'}
          </label>
          <div data-help="step-macd-favorable" style={{ fontSize: 11.5, color: '#98a0a8', lineHeight: 1.45 }}>
            To filter entries on the MACD instead, add an “18–50 MACD favorable” step — it guards the bar the previous step fired on.
          </div>
        </div>
      </div>
    </div>
  );
}
