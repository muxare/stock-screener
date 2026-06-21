import { useMemo } from 'react';
import { useScreener } from '../../store';
import * as M from '../../lib/market';
import { HButton, HDiv } from '../ui/Hoverable';

/**
 * Strategy presets — faithful port of the POC's preset header + cards
 * (Stock Screener.dc.html lines 52–72). Each card shows a live match count and
 * active-state styling per renderVals (lines 1642–1656). Click selects the
 * preset; the ✎ button (only when id !== 'all') opens the preset builder.
 */
export function Presets() {
  const universe = useScreener((s) => s.universe);
  const presetStore = useScreener((s) => s.presetStore);
  const activePreset = useScreener((s) => s.activePreset);
  const newPreset = useScreener((s) => s.newPreset);
  const setPreset = useScreener((s) => s.setPreset);
  const editPreset = useScreener((s) => s.editPreset);

  const presetList = useMemo(() => useScreener.getState().presets(), [presetStore]);

  const cards = useMemo(
    () =>
      presetList.map((p) => {
        const count = universe.filter((s) => M.evalRulesOnStock(s, p.rules)).length;
        const active = p.id === activePreset;
        return {
          id: p.id,
          name: p.name,
          desc: p.desc,
          count,
          editable: p.id !== 'all',
          bg: active ? '#eafaf3' : '#fff',
          border: active ? '#06a96b' : '#ececef',
          titleColor: active ? '#06865a' : '#15171a',
          countBg: active ? '#06a96b' : '#f1f2f3',
          countColor: active ? '#fff' : '#8b9298',
        };
      }),
    [presetList, universe, activePreset],
  );

  return (
    <>
      <div style={{ padding: '18px 18px 12px 18px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600 }}>Strategy presets</span>
        <HButton
          onClick={newPreset}
          title="Save the current filters as a new preset"
          style={{ border: 'none', background: '#eafaf3', color: '#06865a', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}
          hoverStyle={{ background: '#dcf5ea' }}
        >
          + New
        </HButton>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {cards.map((p) => (
          <HDiv
            key={p.id}
            onClick={() => setPreset(p.id)}
            style={{ textAlign: 'left', padding: '11px 13px', borderRadius: 10, border: `1px solid ${p.border}`, background: p.bg, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}
            hoverStyle={{ borderColor: '#cdd8e0' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: p.titleColor }}>{p.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}>
                {p.editable && (
                  <HButton
                    onClick={(e) => { e.stopPropagation(); editPreset(p.id); }}
                    title="Edit preset"
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aab0b6', fontSize: 12, padding: 0, lineHeight: 1 }}
                    hoverStyle={{ color: '#2b5bbf' }}
                  >
                    ✎
                  </HButton>
                )}
                <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: p.countColor, background: p.countBg, padding: '2px 7px', borderRadius: 20 }}>{p.count}</span>
              </div>
            </div>
            <span style={{ fontSize: 11.5, color: '#8b9298', lineHeight: 1.45 }}>{p.desc}</span>
          </HDiv>
        ))}
      </div>
    </>
  );
}
