import { useMemo } from 'react';
import { useScreener } from '../../store';
import * as M from '../../lib/market';
import { HButton } from '../ui/Hoverable';

/**
 * "My screens" list — faithful port of the POC's saved-setup section
 * (Stock Screener.dc.html lines 168–190). Per renderVals 1755–1767: a live
 * match count (when alert+matches), applied-state styling, an ALERT toggle,
 * and ✎ / ✕ edit/delete. Empty state opens the setup builder.
 */
export function Screens() {
  const savedScreens = useScreener((s) => s.savedScreens);
  const customRules = useScreener((s) => s.customRules);
  const alertScreens = useScreener((s) => s.alertScreens);
  const universe = useScreener((s) => s.universe);
  const openScreenBuilder = useScreener((s) => s.openScreenBuilder);
  const applyScreen = useScreener((s) => s.applyScreen);
  const editScreen = useScreener((s) => s.editScreen);
  const deleteScreen = useScreener((s) => s.deleteScreen);
  const toggleAlert = useScreener((s) => s.toggleAlert);

  const rows = useMemo(() => {
    const appliedScreenIds = new Set(customRules.map((r) => (r as { screenId?: string }).screenId).filter(Boolean));
    return savedScreens.map((scr) => {
      const on = appliedScreenIds.has(scr.id);
      const alertOn = !!alertScreens[scr.id];
      const cnt = universe.filter((s) => M.evalRuleAt(s, scr.rule, s.nLast)).length;
      const spec = (scr.rule as { kind: string }).kind === 'group'
        ? M.groupLabel(scr.rule as never)
        : M.chainLabel(scr.rule as never);
      return {
        id: scr.id, name: scr.name, spec, active: on,
        bg: on ? '#eafaf3' : '#fff', border: on ? '#bfe8d6' : '#ececef', titleColor: on ? '#06865a' : '#15171a',
        alertOn, alertBg: alertOn ? '#fff4e6' : '#f4f5f6', alertFg: alertOn ? '#b3641a' : '#9aa1a8',
        liveCount: cnt, showLive: alertOn && cnt > 0,
      };
    });
  }, [savedScreens, customRules, alertScreens, universe]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 4px 10px 4px' }}>
        <span style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600 }}>My screens</span>
        <HButton onClick={openScreenBuilder} style={{ border: 'none', background: '#eef3ff', color: '#2b5bbf', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#e1ebff' }}>+ Build</HButton>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((scr) => {
          const screen = savedScreens.find((s) => s.id === scr.id)!;
          return (
            <div key={scr.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', border: `1px solid ${scr.border}`, borderRadius: 9, background: scr.bg }}>
              <button onClick={() => applyScreen(screen)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 1, padding: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: scr.titleColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scr.name}</span>
                <span style={{ fontSize: 10.5, color: '#9aa1a8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scr.spec}</span>
              </button>
              {scr.showLive && <span style={{ fontSize: 9, fontWeight: 700, color: '#b3641a', background: '#fff4e6', padding: '2px 6px', borderRadius: 20, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{scr.liveCount}</span>}
              {scr.active && <span style={{ fontSize: 9, fontWeight: 700, color: '#06865a', background: '#dcf5ea', padding: '2px 6px', borderRadius: 20, flex: 'none', letterSpacing: '0.04em' }}>ON</span>}
              <button onClick={() => toggleAlert(scr.id)} title="Alert when this screen has matches" style={{ border: 'none', background: scr.alertBg, color: scr.alertFg, fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 6, flex: 'none', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.03em' }}>ALERT</button>
              <HButton onClick={() => editScreen(screen)} title="Edit setup" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aab0b6', fontSize: 12, padding: 2, flex: 'none', lineHeight: 1 }} hoverStyle={{ color: '#2b5bbf' }}>✎</HButton>
              <HButton onClick={() => deleteScreen(scr.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c0c5ca', fontSize: 13, padding: 2, flex: 'none', lineHeight: 1 }} hoverStyle={{ color: '#e23d3d' }}>✕</HButton>
            </div>
          );
        })}
        {savedScreens.length === 0 && (
          <button onClick={openScreenBuilder} style={{ textAlign: 'left', padding: 13, border: '1px dashed #d4d7da', borderRadius: 10, background: '#fafbfb', cursor: 'pointer', fontFamily: 'inherit', color: '#8b9298', fontSize: 12, lineHeight: 1.45 }}>Build a setup — combine comparisons with AND/OR, using bar offsets (t−1, t−2…) to reference prior bars. Recreate any TC2000 PCF.</button>
        )}
      </div>
    </>
  );
}
