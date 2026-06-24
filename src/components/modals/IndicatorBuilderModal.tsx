import { useMemo } from 'react';
import { useScreener } from '../../store';
import * as M from '../../lib/market';
import type { BuilderDraft } from '../../store';
import { HButton, HInput } from '../ui/Hoverable';
import { Spark } from '../ui/Spark';

/**
 * Indicator builder modal — faithful port of the POC's create/edit indicator
 * dialog (Stock Screener.dc.html lines 425–489). Type grid, parameter inputs,
 * a live preview on the first universe member, and an auto-named field.
 * View-model mirrors renderVals 1715–1751.
 */

// local copy of the store's def-clamping logic (POC `_def(b)`) — used to
// compute the live preview series and auto-name from the draft.
function defFromBuilder(b: BuilderDraft): M.IndicatorDef {
  const clamp = (v: unknown, dflt: number, min: number, max: number) => {
    let n = parseInt(String(v), 10);
    if (isNaN(n)) n = dflt;
    return Math.max(min, Math.min(max, n));
  };
  const d: Record<string, unknown> = { type: b.type, source: b.source };
  if (b.type === 'ema' || b.type === 'sma') d.length = clamp(b.length, 21, 2, 400);
  else if (b.type === 'rsi') d.length = clamp(b.length, 14, 2, 100);
  else if (b.type === 'macd') { d.fast = clamp(b.fast, 12, 2, 100); d.slow = clamp(b.slow, 26, 3, 300); d.signal = clamp(b.signal, 9, 1, 100); d.output = b.output; }
  else if (b.type === 'stochrsi') { d.rsiLen = clamp(b.rsiLen, 14, 2, 100); d.stochLen = clamp(b.stochLen, 14, 2, 100); d.kSmooth = clamp(b.kSmooth, 3, 1, 20); d.dSmooth = clamp(b.dSmooth, 3, 1, 20); d.output = b.output; }
  return d as unknown as M.IndicatorDef;
}

export function IndicatorBuilderModal() {
  const builderOpen = useScreener((s) => s.builderOpen);
  const builder = useScreener((s) => s.builder);
  const editingIndId = useScreener((s) => s.editingIndId);
  const sampleStock = useScreener((s) => s.sampleStock);
  const closeBuilder = useScreener((s) => s.closeBuilder);
  const setBuilderType = useScreener((s) => s.setBuilderType);
  const onBuilderParam = useScreener((s) => s.onBuilderParam);
  const onBuilderName = useScreener((s) => s.onBuilderName);
  const saveIndicator = useScreener((s) => s.saveIndicator);

  const typeOptions = useMemo(
    () => Object.entries(M.INDICATOR_TYPES).map(([k, v]) => {
      const active = builder.type === k;
      return {
        value: k, label: v.label, tag: v.tag,
        bg: active ? '#eafaf3' : '#fff', border: active ? '#06a96b' : '#ececef',
        titleColor: active ? '#06865a' : '#15171a',
      };
    }),
    [builder.type],
  );

  const schema = (M.INDICATOR_TYPES as Record<string, { params: { key: string; kind: string; label: string; min?: number; max?: number; options?: { value: string; label: string }[] }[]; scale?: string }>)[builder.type] || { params: [] };
  const builderParams = schema.params.map((p) => ({
    key: p.key, label: p.label,
    isSelect: p.kind !== 'int', isNumber: p.kind === 'int',
    value: builder[p.key] as string | number, min: p.min, max: p.max,
    options: p.kind === 'source' ? M.SOURCES : (p.options || []),
  }));

  const preview = ((): { builderName: string; previewValue: string; previewScale: string; sampleTicker: string; spark: number[] | null } => {
    const bdef = defFromBuilder(builder);
    const builderName = builder.nameTouched ? builder.name : M.autoIndName(bdef);
    // One displayed name fetched at boot (SAD#2.5) drives the live preview.
    const sample = sampleStock;
    let previewValue = '—', previewScale = '', sampleTicker = '';
    let spark: number[] | null = null;
    if (sample) {
      sampleTicker = sample.ticker;
      const series = M.indSeries(sample, bdef);
      const last = series[series.length - 1];
      const sc = schema.scale;
      if (last != null && !isNaN(last)) {
        if (sc === 'price') previewValue = bdef.source === 'volume' ? (last / 1e6).toFixed(2) + 'M' : '$' + last.toFixed(2);
        else if (sc === 'osc') previewValue = last.toFixed(1);
        else previewValue = last.toFixed(3);
      }
      previewScale = sc === 'osc' ? 'oscillator · 0–100' : sc === 'center' ? 'centered around zero' : 'price scale';
      const clean = series.filter((v): v is number => v != null && !isNaN(v)).slice(-50);
      if (clean.length > 1) spark = clean;
    }
    return { builderName, previewValue, previewScale, sampleTicker, spark };
  })();

  if (!builderOpen) return null;

  const title = editingIndId ? 'Edit indicator' : 'Create indicator';
  const subtitle = editingIndId ? 'Adjust its inputs — changes apply everywhere it’s used.' : 'Pick a type, configure its inputs, and save it to reuse across screens.';
  const saveLabel = editingIndId ? 'Save changes' : 'Save indicator';

  return (
    <div onClick={closeBuilder} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 564, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', animation: 'popin 0.18s ease' }}>
        <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid #f0f1f2' }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 3 }}>{subtitle}</div>
        </div>

        <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* type */}
          <div>
            <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 9 }}>Indicator type</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {typeOptions.map((t) => (
                <button key={t.value} onClick={() => setBuilderType(t.value as M.IndicatorType)} style={{ textAlign: 'left', padding: '10px 11px', borderRadius: 10, border: `1.5px solid ${t.border}`, background: t.bg, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.titleColor }}>{t.label}</span>
                  <span style={{ fontSize: 11, color: '#9aa1a8', lineHeight: 1.3 }}>{t.tag}</span>
                </button>
              ))}
            </div>
          </div>

          {/* params */}
          <div>
            <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 9 }}>Parameters</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 11 }}>
              {builderParams.map((bp) => (
                <div key={bp.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 11, color: '#8b9298', fontWeight: 500 }}>{bp.label}</span>
                  {bp.isSelect && (
                    <select value={bp.value} onChange={(e) => onBuilderParam(bp.key, e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: '1px solid #e2e4e6', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
                      {bp.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  {bp.isNumber && (
                    <input type="number" value={bp.value} onChange={(e) => onBuilderParam(bp.key, e.target.value)} min={bp.min} max={bp.max} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: '1px solid #e2e4e6', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff' }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* live preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', background: '#f7f8f9', borderRadius: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview · {preview.sampleTicker}</div>
              <div style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2, color: '#15171a' }}>{preview.previewValue}</div>
              <div style={{ fontSize: 11, color: '#9aa1a8' }}>{preview.previewScale}</div>
            </div>
            <div style={{ flex: 'none' }}>{preview.spark && <Spark values={preview.spark} color="#06a96b" />}</div>
          </div>

          {/* name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#8b9298', fontWeight: 500 }}>Name</span>
            <HInput value={preview.builderName} onChange={(e) => onBuilderName(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 11px', border: '1px solid #e2e4e6', borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: '#fff', outline: 'none' }} focusStyle={{ borderColor: '#06a96b' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '14px 24px 20px', borderTop: '1px solid #f0f1f2' }}>
          <HButton onClick={closeBuilder} style={{ flex: 1, padding: 11, border: '1px solid #e2e4e6', borderRadius: 10, background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f5f6f7' }}>Cancel</HButton>
          <HButton onClick={saveIndicator} style={{ flex: 2, padding: 11, border: 'none', borderRadius: 10, background: '#06a96b', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#05935d' }}>{saveLabel}</HButton>
        </div>
      </div>
    </div>
  );
}
