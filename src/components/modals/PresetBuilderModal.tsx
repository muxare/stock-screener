import { useEffect, useState } from 'react';
import { useScreener } from '../../store';
import * as M from '../../lib/market';
import { HButton, HInput } from '../ui/Hoverable';
import { CustomChips, ChipEditor } from '../sidebar/ActiveFilters';
import { RuleSection, PatternSection, RankSection } from '../sidebar/FilterSections';

/**
 * Preset (strategy) builder modal — faithful port of the POC
 * (Stock Screener.dc.html lines 727–937). Renders only while a preset is being
 * edited (store.editingPreset). The custom-chip list + inline ChipEditor and
 * the three filter-builder sections are reused from the sidebar. Reset/Delete
 * availability mirrors renderVals (lines 1959–1962).
 */
export function PresetBuilderModal() {
  const editingPreset = useScreener((s) => s.editingPreset);
  const presetName = useScreener((s) => s.presetName);
  const presetDesc = useScreener((s) => s.presetDesc);
  const customRules = useScreener((s) => s.customRules);
  const editChip = useScreener((s) => s.editChip);
  const universeSize = useScreener((s) => s.universeSize);
  const previewCount = useScreener((s) => s.previewCount);
  const presetStore = useScreener((s) => s.presetStore);
  const onPresetName = useScreener((s) => s.onPresetName);
  const onPresetDesc = useScreener((s) => s.onPresetDesc);
  const savePreset = useScreener((s) => s.savePreset);
  const cancelPresetEdit = useScreener((s) => s.cancelPresetEdit);
  const resetPreset = useScreener((s) => s.resetPreset);
  const deletePreset = useScreener((s) => s.deletePreset);
  const addFlag = useScreener((s) => s.addFlag);

  // Full-universe match count for the draft comes from the service (SAD#2.5),
  // debounced so a chip edit doesn't fire a request per keystroke.
  // null = count unknown (service unreachable); rendered as "—", never "0".
  const [presetDraftCount, setPresetDraftCount] = useState<number | null>(0);
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      if (!editingPreset) { if (live) setPresetDraftCount(0); return; }
      void previewCount(customRules).then((n) => { if (live) setPresetDraftCount(n); });
    }, 200);
    return () => { live = false; clearTimeout(id); };
  }, [editingPreset, customRules, previewCount]);

  if (!editingPreset) return null;

  const title = editingPreset === '__new__' ? 'New preset' : 'Editing preset';
  const noChips = customRules.length === 0;
  const flagChips = Object.entries(M.FLAGS).map(([k, v]) => ({ field: k, label: v }));
  const canReset = !!(editingPreset !== '__new__' && M.PRESETS.some((p) => p.id === editingPreset) && presetStore.overrides[editingPreset]);
  const canDelete = !!(editingPreset !== '__new__' && (presetStore.custom || []).some((p) => p.id === editingPreset));

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const nameInputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '10px 11px', border: '1px solid #e2e4e6', borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: '#fff', outline: 'none' };
  const descInputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '10px 11px', border: '1px solid #e2e4e6', borderRadius: 9, fontSize: 12, fontFamily: 'inherit', background: '#fff', outline: 'none' };

  return (
    <div onClick={cancelPresetEdit} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={stop} style={{ width: 560, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', animation: 'popin 0.18s ease' }}>
        <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid #f0f1f2' }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 3, lineHeight: 1.45 }}>A strategy preset is a named bundle of filters. Add, remove, or tap a chip to tweak — then save.</div>
        </div>

        <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <HInput value={presetName} onChange={(e) => onPresetName(e.target.value)} placeholder="Preset name" style={nameInputStyle} focusStyle={{ borderColor: '#06a96b' }} />
            <HInput value={presetDesc} onChange={(e) => onPresetDesc(e.target.value)} placeholder="Short description (optional)" style={descInputStyle} focusStyle={{ borderColor: '#06a96b' }} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}>
              <span style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Filters in this preset</span>
              <span style={{ fontSize: 12, color: '#8b9298' }}>
                <b style={{ color: '#15171a', fontVariantNumeric: 'tabular-nums' }}>{presetDraftCount == null ? '—' : presetDraftCount}</b> / {universeSize} match
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <CustomChips />
              {noChips && <span style={{ fontSize: 12, color: '#aab0b6', padding: '3px 0' }}>No filters yet — add some below. (Empty = the full universe.)</span>}
            </div>
            {editChip != null && <ChipEditor />}
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 9 }}>Add a filter</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {flagChips.map((fc) => (
                <HButton key={fc.field} onClick={() => addFlag(fc.field)} style={{ fontSize: 11, padding: '5px 9px', borderRadius: 7, border: '1px solid #dfe1e4', background: '#fff', color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f5f6f7' }}>
                  + {fc.label}
                </HButton>
              ))}
            </div>

            <div style={{ marginBottom: 8 }}><RuleSection /></div>
            <div style={{ marginBottom: 8 }}><PatternSection /></div>
            <RankSection />
          </div>

          <div style={{ display: 'flex', gap: 14 }}>
            {canReset && (
              <button onClick={resetPreset} style={{ border: 'none', background: 'none', color: '#b3641a', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>↺ Reset to built-in default</button>
            )}
            {canDelete && (
              <button onClick={deletePreset} style={{ border: 'none', background: 'none', color: '#e23d3d', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Delete preset</button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '14px 24px 20px', borderTop: '1px solid #f0f1f2' }}>
          <HButton onClick={cancelPresetEdit} style={{ flex: 1, padding: 11, border: '1px solid #e2e4e6', borderRadius: 10, background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f5f6f7' }}>Cancel</HButton>
          <HButton onClick={savePreset} style={{ flex: 2, padding: 11, border: 'none', borderRadius: 10, background: '#06a96b', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#05935d' }}>Save preset</HButton>
        </div>
      </div>
    </div>
  );
}
