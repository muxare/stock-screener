import { useEffect, useMemo, useState } from 'react';
import { useScreener } from '../../store';
import * as M from '../../lib/market';
import type { OperandDraft } from '../../store';
import { HButton, HInput, HTextarea } from '../ui/Hoverable';

/**
 * Setup (condition-group) builder modal — faithful port of the POC's setup
 * dialog (Stock Screener.dc.html lines 492–622). PCF paste box, per-condition
 * rows (operand src/const/offset/×+ math, op select, AND/OR conj), a live
 * preview, and a name field. View-model mirrors renderVals 1769–1807.
 */
export function ScreenBuilderModal() {
  const screenBuilderOpen = useScreener((s) => s.screenBuilderOpen);
  const screenDraft = useScreener((s) => s.screenDraft);
  const editingScreenId = useScreener((s) => s.editingScreenId);
  const savedIndicators = useScreener((s) => s.savedIndicators);
  const universeSize = useScreener((s) => s.universeSize);
  const previewCount = useScreener((s) => s.previewCount);
  const mathOpen = useScreener((s) => s.mathOpen);
  const pcfOpen = useScreener((s) => s.pcfOpen);
  const pcfText = useScreener((s) => s.pcfText);
  const pcfError = useScreener((s) => s.pcfError);

  const closeScreenBuilder = useScreener((s) => s.closeScreenBuilder);
  const setCondSrc = useScreener((s) => s.setCondSrc);
  const setCondOffset = useScreener((s) => s.setCondOffset);
  const setCondConst = useScreener((s) => s.setCondConst);
  const setCondOp = useScreener((s) => s.setCondOp);
  const toggleCondConj = useScreener((s) => s.toggleCondConj);
  const addCond = useScreener((s) => s.addCond);
  const removeCond = useScreener((s) => s.removeCond);
  const loadExample = useScreener((s) => s.loadExample);
  const toggleMath = useScreener((s) => s.toggleMath);
  const setCondMult = useScreener((s) => s.setCondMult);
  const setCondAdd = useScreener((s) => s.setCondAdd);
  const togglePcf = useScreener((s) => s.togglePcf);
  const onPcfText = useScreener((s) => s.onPcfText);
  const onParsePCF = useScreener((s) => s.onParsePCF);
  const onScreenName = useScreener((s) => s.onScreenName);
  const saveScreen = useScreener((s) => s.saveScreen);

  const operandOptions = useMemo(
    () => [
      ...M.OPERAND_FIELDS.map((f) => ({ value: 'field:' + f.value, label: f.label })),
      ...savedIndicators.map((i) => ({ value: 'ind:' + (i as { id: string }).id, label: i.name || '' })),
      { value: 'const', label: 'a value' },
    ],
    [savedIndicators],
  );

  const view = useMemo(() => {
    if (!screenDraft) return null;
    const opView = (op: OperandDraft, idx: number, side: 'left' | 'right') => {
      const mathActive = (op.mult != null && +op.mult !== 1) || (op.add != null && +op.add !== 0);
      const open = !!mathOpen[idx + ':' + side];
      return {
        srcValue: op.kind === 'const' ? 'const' : op.kind === 'field' ? 'field:' + op.field : 'ind:' + op.id,
        isConst: op.kind === 'const', showOffset: op.kind !== 'const',
        offset: op.offset != null ? op.offset : 0, value: op.value != null ? op.value : 0,
        mult: op.mult != null ? op.mult : 1, add: op.add != null ? op.add : 0,
        showMath: op.kind !== 'const' && (open || mathActive),
        mathBtnBg: mathActive ? '#eef3ff' : '#fff', mathBtnFg: mathActive ? '#2b5bbf' : '#aab0b6', mathBtnBorder: mathActive ? '#cfddfb' : '#e2e4e6',
      };
    };
    const condRows = screenDraft.conds.map((c, idx) => ({
      idx,
      badge: String.fromCharCode(65 + idx),
      showConj: idx > 0, conjLabel: c.conj === 'or' ? 'OR' : 'AND',
      conjBg: c.conj === 'or' ? '#fff4e6' : '#eef3ff', conjFg: c.conj === 'or' ? '#b3641a' : '#2b5bbf', conjBorder: c.conj === 'or' ? '#f3d9b8' : '#cfddfb',
      opValue: c.op, canRemove: screenDraft.conds.length > 1,
      left: opView(c.left, idx, 'left'), right: opView(c.right, idx, 'right'),
    }));
    const sRule = useScreener.getState().screenRule(screenDraft);
    const screenName = screenDraft.nameTouched ? screenDraft.name : (sRule ? M.groupLabel(sRule as never) : '');
    const setupPreview = sRule ? M.groupLabel(sRule as never) : '';
    return { condRows, screenName, setupPreview };
  }, [screenDraft, mathOpen]);

  // Full-universe preview count comes from the service (SAD#2.5), debounced so a
  // keystroke doesn't fire a request per character.
  // null = count unknown (service unreachable); rendered as "—", never "0".
  const [screenMatchN, setScreenMatchN] = useState<number | null>(0);
  useEffect(() => {
    if (!screenDraft) return;
    let live = true;
    const id = setTimeout(() => {
      const sRule = useScreener.getState().screenRule(screenDraft);
      if (!sRule) { if (live) setScreenMatchN(0); return; }
      void previewCount([sRule]).then((n) => { if (live) setScreenMatchN(n); });
    }, 200);
    return () => { live = false; clearTimeout(id); };
  }, [screenDraft, previewCount]);

  if (!screenBuilderOpen || !screenDraft || !view) return null;

  const title = editingScreenId ? 'Edit setup' : 'Build a setup';
  const saveLabel = editingScreenId ? 'Save changes' : 'Save & apply setup';

  // shared operand-side renderer (left/right are identical in markup)
  const renderSide = (
    row: NonNullable<typeof view>['condRows'][number],
    side: 'left' | 'right',
  ) => {
    const o = row[side];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={o.srcValue} onChange={(e) => setCondSrc(row.idx, side, e.target.value)} style={{ flex: 1, minWidth: 0, padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
            {operandOptions.map((oo) => <option key={oo.value} value={oo.value}>{oo.label}</option>)}
          </select>
          {o.isConst && (
            <input type="number" value={o.value} onChange={(e) => setCondConst(row.idx, side, e.target.value)} style={{ width: 78, flex: 'none', boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
          )}
          {o.showOffset && (
            <>
              <div title="Bars ago (t−N). 0 = current bar." style={{ position: 'relative', flex: 'none' }}>
                <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: '#aab0b6', fontSize: 11, pointerEvents: 'none' }}>t−</span>
                <input type="number" min={0} max={20} value={o.offset} onChange={(e) => setCondOffset(row.idx, side, e.target.value)} style={{ width: 56, boxSizing: 'border-box', padding: '8px 6px 8px 24px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', textAlign: 'center' }} />
              </div>
              <button onClick={() => toggleMath(row.idx, side)} title="Multiply / add a constant" style={{ flex: 'none', width: 30, height: 33, border: `1px solid ${o.mathBtnBorder}`, borderRadius: 8, background: o.mathBtnBg, color: o.mathBtnFg, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}>×</button>
            </>
          )}
        </div>
        {o.showMath && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', paddingLeft: 2 }}>
            <span style={{ fontSize: 12, color: '#9aa1a8', fontWeight: 700 }}>×</span>
            <input type="number" step="0.01" value={o.mult} onChange={(e) => setCondMult(row.idx, side, e.target.value)} style={{ width: 72, boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
            <span style={{ fontSize: 12, color: '#9aa1a8', fontWeight: 700 }}>+</span>
            <input type="number" step="0.01" value={o.add} onChange={(e) => setCondAdd(row.idx, side, e.target.value)} style={{ width: 72, boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
            <span style={{ fontSize: 10.5, color: '#bcc2c8' }}>e.g. ×1.02 = +2%</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div onClick={closeScreenBuilder} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 564, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', animation: 'popin 0.18s ease' }}>
        <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid #f0f1f2' }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 3, lineHeight: 1.45 }}>Combine comparisons with AND / OR. Any operand can look back N bars — <b style={{ color: '#6b7280' }}>t−1</b> is the prior bar, like TC2000's <span style={{ fontFamily: 'monospace' }}>.1</span> suffix.</div>
        </div>

        <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* PCF paste box */}
          <div style={{ border: '1px solid #d7e6ff', borderRadius: 11, background: '#f7faff', overflow: 'hidden' }}>
            <HButton onClick={togglePcf} style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '11px 13px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#eef4ff' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#2b5bbf' }}>⎘ Paste a TC2000 formula</span>
              <span style={{ fontSize: 10, color: '#9bb4e0' }}>{pcfOpen ? '▲' : '▼'}</span>
            </HButton>
            {pcfOpen && (
              <div style={{ padding: '0 13px 13px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                <HTextarea value={pcfText} onChange={(e) => onPcfText(e.target.value)} placeholder={'O>L1 AND C>L1 AND L<L1 AND\nO>XAVGC50 AND C>XAVGC50 AND L<XAVGC50 AND\nXAVGC18>XAVGC50 AND XAVGC50>XAVGC100 AND XAVGC100>XAVGC200'} rows={5} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 11px', border: '1px solid #cfddfb', borderRadius: 9, fontSize: 12, fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", background: '#fff', outline: 'none', resize: 'vertical', lineHeight: 1.55, color: '#15171a' }} focusStyle={{ borderColor: '#2b5bbf' }} />
                {pcfError && <div style={{ fontSize: 11.5, color: '#e23d3d', lineHeight: 1.45 }}>{pcfError}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <HButton onClick={onParsePCF} style={{ flex: 'none', padding: '8px 16px', border: 'none', borderRadius: 8, background: '#2b5bbf', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#244f9f' }}>Parse → conditions</HButton>
                  <span style={{ fontSize: 10.5, color: '#9aa1a8', lineHeight: 1.45 }}>O/H/L/C/V (C1 = 1 bar ago), XAVGC50, AVGV60, .1 offsets, ×/+ math. Missing indicators are auto-created.</span>
                </div>
              </div>
            )}
          </div>

          {/* condition rows */}
          {view.condRows.map((row) => (
            <div key={row.idx}>
              {row.showConj && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                  <button onClick={() => toggleCondConj(row.idx)} title="Toggle AND / OR" style={{ border: `1px solid ${row.conjBorder}`, background: row.conjBg, color: row.conjFg, fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', padding: '3px 13px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit' }}>{row.conjLabel}</button>
                </div>
              )}
              <div style={{ border: '1px solid #ececef', borderRadius: 11, background: '#fafbfb', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, background: '#eceef0', color: '#8b9298', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{row.badge}</span>
                  <div style={{ flex: 1 }} />
                  {row.canRemove && (
                    <HButton onClick={() => removeCond(row.idx)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c0c5ca', fontSize: 13, padding: 2, lineHeight: 1 }} hoverStyle={{ color: '#e23d3d' }}>✕</HButton>
                  )}
                </div>
                {renderSide(row, 'left')}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <select value={row.opValue} onChange={(e) => setCondOp(row.idx, e.target.value)} style={{ width: 150, padding: '6px 9px', border: '1px solid #d7e6ff', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: '#f4f8ff', color: '#2b5bbf', cursor: 'pointer', textAlign: 'center', textAlignLast: 'center' }}>
                    {M.GROUP_OPS.map((oo) => <option key={oo.value} value={oo.value}>{oo.label}</option>)}
                  </select>
                </div>
                {renderSide(row, 'right')}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8 }}>
            <HButton onClick={addCond} style={{ flex: 1, padding: 9, border: '1px dashed #cdd3d8', borderRadius: 9, background: '#fff', color: '#6b7280', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f7f8f9' }}>+ Add condition</HButton>
            <HButton onClick={loadExample} title="Loads the TC2000 GREEN-RED reversal as a worked example" style={{ flex: 'none', padding: '9px 14px', border: '1px solid #ececef', borderRadius: 9, background: '#fff', color: '#2b5bbf', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f4f8ff' }}>Load example</HButton>
          </div>

          <div style={{ padding: '11px 14px', background: '#f7f8f9', borderRadius: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {view.setupPreview && <div style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.55, wordBreak: 'break-word' }}>{view.setupPreview}</div>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#8b9298' }}>Matches right now</span>
              <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{screenMatchN == null ? '—' : screenMatchN}<span style={{ fontSize: 11, color: '#9aa1a8', fontWeight: 500 }}> / {universeSize}</span></span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#8b9298', fontWeight: 500 }}>Name</span>
            <HInput value={view.screenName} onChange={(e) => onScreenName(e.target.value)} placeholder="e.g. EMA bounce (long)" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 11px', border: '1px solid #e2e4e6', borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: '#fff', outline: 'none' }} focusStyle={{ borderColor: '#06a96b' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '14px 24px 20px', borderTop: '1px solid #f0f1f2' }}>
          <HButton onClick={closeScreenBuilder} style={{ flex: 1, padding: 11, border: '1px solid #e2e4e6', borderRadius: 10, background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f5f6f7' }}>Cancel</HButton>
          <HButton onClick={saveScreen} style={{ flex: 2, padding: 11, border: 'none', borderRadius: 10, background: '#06a96b', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#05935d' }}>{saveLabel}</HButton>
        </div>
      </div>
    </div>
  );
}
