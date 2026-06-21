import { useScreener } from '../../store';
import { HButton } from '../ui/Hoverable';

/**
 * "My indicators" list — faithful port of the POC's indicator section
 * (Stock Screener.dc.html lines 146–166). Each row shows a color dot, name and
 * spec (store.specOf); ✎ edits and ✕ deletes. Empty state opens the builder.
 */
export function Indicators() {
  const savedIndicators = useScreener((s) => s.savedIndicators);
  const openBuilder = useScreener((s) => s.openBuilder);
  const editIndicator = useScreener((s) => s.editIndicator);
  const deleteIndicator = useScreener((s) => s.deleteIndicator);
  const specOf = useScreener((s) => s.specOf);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 4px 10px 4px' }}>
        <span style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600 }}>My indicators</span>
        <HButton onClick={openBuilder} style={{ border: 'none', background: '#eafaf3', color: '#06865a', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#dcf5ea' }}>+ New</HButton>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {savedIndicators.map((ind) => {
          const id = (ind as { id: string }).id;
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', border: '1px solid #ececef', borderRadius: 9, background: '#fff' }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: ind.color || '#06a96b', flex: 'none' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ind.name}</span>
                <span style={{ fontSize: 10.5, color: '#9aa1a8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{specOf(ind)}</span>
              </div>
              <HButton onClick={() => editIndicator(id)} title="Edit indicator" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#aab0b6', fontSize: 12, padding: 2, flex: 'none', lineHeight: 1 }} hoverStyle={{ color: '#2b5bbf' }}>✎</HButton>
              <HButton onClick={() => deleteIndicator(id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c0c5ca', fontSize: 13, padding: 2, flex: 'none', lineHeight: 1 }} hoverStyle={{ color: '#e23d3d' }}>✕</HButton>
            </div>
          );
        })}
        {savedIndicators.length === 0 && (
          <button onClick={openBuilder} style={{ textAlign: 'left', padding: 13, border: '1px dashed #d4d7da', borderRadius: 10, background: '#fafbfb', cursor: 'pointer', fontFamily: 'inherit', color: '#8b9298', fontSize: 12, lineHeight: 1.45 }}>No indicators yet — create an EMA, MACD, RSI or Stoch RSI to screen on.</button>
        )}
      </div>
    </>
  );
}
