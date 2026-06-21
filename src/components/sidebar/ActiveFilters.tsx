import { useMemo } from 'react';
import { useScreener } from '../../store';
import * as M from '../../lib/market';

/**
 * Active filter chips + inline chip editor — faithful port of the POC
 * (Stock Screener.dc.html lines 74–144). Preset rules render as fixed green
 * AND chips; custom rules render as editable blue chips carrying AND/OR
 * conjunction toggles. The chip view-models mirror renderVals (lines 1660–1667)
 * and the editor view-model mirrors renderVals (lines 1671–1696).
 *
 * Both `ActiveFilters` and `ChipEditor` are exported so the preset builder
 * modal can reuse the same chip list + editor.
 */

const chipWrap = { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 6 };

interface CustomChip {
  label: string;
  showConj: boolean;
  conjLabel: string;
  conjBg: string;
  conjFg: string;
  conjBorder: string;
  editBg: string;
  editBorder: string;
}

// shared renderer for the custom (blue, editable) chip list — used by both the
// sidebar Active filters and the preset builder modal's "Filters in this preset".
export function CustomChips() {
  const customRules = useScreener((s) => s.customRules);
  const editChip = useScreener((s) => s.editChip);
  const ruleLabel = useScreener((s) => s.ruleLabel);
  const removeRule = useScreener((s) => s.removeRule);
  const openChipEdit = useScreener((s) => s.openChipEdit);
  const toggleRuleConj = useScreener((s) => s.toggleRuleConj);

  const chips = useMemo<CustomChip[]>(
    () =>
      customRules.map((rr, i) => ({
        label: ruleLabel(rr),
        showConj: i > 0,
        conjLabel: (rr as { conj?: string }).conj === 'or' ? 'OR' : 'AND',
        conjBg: (rr as { conj?: string }).conj === 'or' ? '#fff4e6' : '#eef3ff',
        conjFg: (rr as { conj?: string }).conj === 'or' ? '#b3641a' : '#2b5bbf',
        conjBorder: (rr as { conj?: string }).conj === 'or' ? '#f3d9b8' : '#cfddfb',
        editBg: editChip === i ? '#d7e6ff' : '#eef3ff',
        editBorder: editChip === i ? '#2b5bbf' : '#cfddfb',
      })),
    [customRules, editChip, ruleLabel],
  );

  return (
    <>
      {chips.map((c, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {c.showConj && (
            <button
              onClick={() => toggleRuleConj(i)}
              title="Toggle AND / OR"
              style={{ border: `1px solid ${c.conjBorder}`, background: c.conjBg, color: c.conjFg, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', padding: '3px 7px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {c.conjLabel}
            </button>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, padding: '5px 9px', borderRadius: 7, background: c.editBg, color: '#2b5bbf', border: `1px solid ${c.editBorder}` }}>
            <button onClick={() => openChipEdit(i)} title="Edit filter" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#2b5bbf', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500, padding: 0, lineHeight: 1.2 }}>{c.label}</button>
            <button onClick={() => removeRule(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#2b5bbf', fontSize: 13, padding: 0, lineHeight: 1, opacity: 0.7 }}>✕</button>
          </span>
        </span>
      ))}
    </>
  );
}

export function ActiveFilters() {
  const customRules = useScreener((s) => s.customRules);
  const activePreset = useScreener((s) => s.activePreset);
  const presetStore = useScreener((s) => s.presetStore);
  const ruleLabel = useScreener((s) => s.ruleLabel);
  const editChip = useScreener((s) => s.editChip);

  const presetChips = useMemo(() => {
    const preset = useScreener.getState().presetById(activePreset);
    return preset.rules.map((rr) => ({ label: ruleLabel(rr) }));
  }, [activePreset, presetStore, ruleLabel]);

  const noChips = presetChips.length === 0 && customRules.length === 0;

  return (
    <>
      <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600, margin: '20px 4px 10px 4px' }}>Active filters</div>
      <div style={chipWrap}>
        {presetChips.map((c, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, padding: '5px 9px', borderRadius: 7, background: '#eafaf3', color: '#06865a', border: '1px solid #bfe8d6' }}>{c.label}</span>
        ))}
        <CustomChips />
        {noChips && <span style={{ fontSize: 12, color: '#aab0b6', padding: '3px 0' }}>No filters — full universe.</span>}
      </div>
      {editChip != null && <ChipEditor />}
    </>
  );
}

export function ChipEditor() {
  const customRules = useScreener((s) => s.customRules);
  const editChip = useScreener((s) => s.editChip);
  const savedScreens = useScreener((s) => s.savedScreens);
  const ruleLabel = useScreener((s) => s.ruleLabel);
  const closeChipEdit = useScreener((s) => s.closeChipEdit);
  const onChipNum = useScreener((s) => s.onChipNum);
  const onChipPatternN = useScreener((s) => s.onChipPatternN);
  const onChipRank = useScreener((s) => s.onChipRank);
  const onChipIndConst = useScreener((s) => s.onChipIndConst);
  const editScreen = useScreener((s) => s.editScreen);

  if (editChip == null || !customRules[editChip]) return null;
  const i = editChip;
  const rr = customRules[i] as unknown as Record<string, unknown> & { kind: string };

  // mirror renderVals chipEditor view-model (lines 1671–1696)
  type Editor = {
    isValue?: boolean; isBetween?: boolean; isN?: boolean; isRank?: boolean; isSetup?: boolean;
    note?: string;
    value?: unknown; min?: unknown; max?: unknown;
    n?: unknown; countLabel?: string; nMin?: unknown; nMax?: unknown;
    dir?: unknown; pct?: unknown; rfield?: unknown; scope?: unknown;
    rankFieldOptions?: { value: string; label: string }[];
  };
  const ed: Editor = {};

  if (rr.kind === 'pattern') {
    const meta = (M.PATTERNS as Record<string, M.PatternMeta>)[rr.pat as string] || ({} as M.PatternMeta);
    if (meta.count) { ed.isN = true; ed.countLabel = meta.countLabel || 'Count'; ed.n = rr.n; ed.nMin = meta.min; ed.nMax = meta.max; }
    else ed.note = 'This pattern has no parameters to tweak.';
  } else if (rr.kind === 'rank') {
    ed.isRank = true; ed.dir = rr.dir; ed.pct = rr.pct; ed.rfield = rr.field; ed.scope = rr.scope;
    ed.rankFieldOptions = Object.entries(M.RANK_FIELDS).map(([k, v]) => ({ value: k, label: v }));
  } else if (rr.kind === 'num' && rr.op === 'between') {
    ed.isBetween = true; ed.min = rr.min; ed.max = rr.max;
  } else if (rr.kind === 'num') {
    ed.isValue = true; ed.value = rr.value;
  } else if (rr.kind === 'ind' && rr.op === 'between') {
    ed.isBetween = true; ed.min = rr.min; ed.max = rr.max;
  } else if (rr.kind === 'ind' && (rr.rhs as { type?: string } | undefined)?.type === 'const') {
    ed.isValue = true; ed.value = (rr.rhs as { value?: unknown }).value;
  } else if ((rr.kind === 'group' || rr.kind === 'chain') && rr.screenId && savedScreens.some((s) => s.id === rr.screenId)) {
    ed.isSetup = true;
  } else {
    ed.note = 'Remove and re-add to change this filter.';
  }

  const inputStyle = { flex: 1, minWidth: 0, boxSizing: 'border-box' as const, padding: '8px 9px', border: '1px solid #cfddfb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' };
  const selStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '8px 9px', border: '1px solid #cfddfb', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' };

  return (
    <div style={{ marginTop: 10, border: '1px solid #cfddfb', borderRadius: 10, background: '#f7faff', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#2b5bbf' }}>Edit filter</span>
        <button onClick={closeChipEdit} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9aa1a8', fontSize: 13, lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.45, marginBottom: 10, wordBreak: 'break-word' }}>{ruleLabel(customRules[i])}</div>

      {ed.isValue && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Value</span>
          <input
            type="number"
            value={ed.value as string | number}
            onChange={(e) => (rr.kind === 'ind' ? onChipIndConst(i, e.target.value) : onChipNum(i, 'value', e.target.value))}
            style={inputStyle}
          />
        </div>
      )}

      {ed.isBetween && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" value={ed.min as string | number} onChange={(e) => onChipNum(i, 'min', e.target.value)} placeholder="min" style={inputStyle} />
          <input type="number" value={ed.max as string | number} onChange={(e) => onChipNum(i, 'max', e.target.value)} placeholder="max" style={inputStyle} />
        </div>
      )}

      {ed.isN && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#6b7280', flex: 1 }}>{ed.countLabel}</span>
          <input
            type="number"
            min={ed.nMin as number}
            max={ed.nMax as number}
            value={ed.n as string | number}
            onChange={(e) => onChipPatternN(i, e.target.value)}
            style={{ width: 78, boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #cfddfb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', textAlign: 'center' }}
          />
        </div>
      )}

      {ed.isRank && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={ed.dir as string} onChange={(e) => onChipRank(i, 'dir', e.target.value)} style={{ flex: 'none', width: 92, padding: '8px 9px', border: '1px solid #cfddfb', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
            <div style={{ position: 'relative', flex: 1 }}>
              <input type="number" min={1} max={99} value={ed.pct as string | number} onChange={(e) => onChipRank(i, 'pct', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 22px 8px 9px', border: '1px solid #cfddfb', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
              <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#aab0b6', fontSize: 12 }}>%</span>
            </div>
          </div>
          <select value={ed.rfield as string} onChange={(e) => onChipRank(i, 'field', e.target.value)} style={selStyle}>
            {ed.rankFieldOptions!.map((rf) => <option key={rf.value} value={rf.value}>{rf.label}</option>)}
          </select>
          <select value={ed.scope as string} onChange={(e) => onChipRank(i, 'scope', e.target.value)} style={selStyle}>
            <option value="all">Across whole universe</option>
            <option value="sector">Within each sector</option>
          </select>
        </div>
      )}

      {ed.isSetup && (
        <button
          onClick={() => { const scr = savedScreens.find((s) => s.id === (rr.screenId as string)); if (scr) { closeChipEdit(); editScreen(scr); } }}
          style={{ width: '100%', padding: 9, border: 'none', borderRadius: 8, background: '#2b5bbf', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Open in setup builder
        </button>
      )}

      {ed.note && <div style={{ fontSize: 11.5, color: '#9aa1a8', lineHeight: 1.45 }}>{ed.note}</div>}
    </div>
  );
}
