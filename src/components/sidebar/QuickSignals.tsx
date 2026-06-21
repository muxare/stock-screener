import { useScreener } from '../../store';
import * as M from '../../lib/market';
import { HButton } from '../ui/Hoverable';

/**
 * Quick signals — flag chips that add a boolean signal filter, plus the
 * "Reset all filters" button. Faithful port of the POC
 * (Stock Screener.dc.html lines 291–298); flagChips mirror renderVals 1713.
 */
export function QuickSignals() {
  const addFlag = useScreener((s) => s.addFlag);
  const clearAll = useScreener((s) => s.clearAll);

  const flagChips = Object.entries(M.FLAGS).map(([k, v]) => ({ field: k, label: v }));

  return (
    <>
      <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600, margin: '18px 4px 9px 4px' }}>Quick signals</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {flagChips.map((fc) => (
          <HButton
            key={fc.field}
            onClick={() => addFlag(fc.field)}
            style={{ fontSize: 11, padding: '5px 9px', borderRadius: 7, border: '1px solid #dfe1e4', background: '#fff', color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit' }}
            hoverStyle={{ background: '#f5f6f7' }}
          >
            + {fc.label}
          </HButton>
        ))}
      </div>
      <HButton
        onClick={clearAll}
        style={{ marginTop: 16, width: '100%', padding: 8, border: '1px solid #ececef', borderRadius: 8, background: '#fff', color: '#8b9298', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
        hoverStyle={{ background: '#f5f6f7' }}
      >
        Reset all filters
      </HButton>
    </>
  );
}
