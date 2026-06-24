import { useScreener } from '../store';
import { HInput } from './ui/Hoverable';

/**
 * Top bar — faithful port of the POC's TOP BAR (Stock Screener.dc.html lines
 * 24–45): logo block, search input, spacer, and the Overlay/Docked layout
 * toggle. Inline styles copied from the POC; the layout button styling mirrors
 * renderVals' `layoutBtns` (lines 1888–1895).
 */
export function TopBar() {
  const search = useScreener((s) => s.search);
  const onSearch = useScreener((s) => s.onSearch);
  const layout = useScreener((s) => s.layout);
  const setLayout = useScreener((s) => s.setLayout);

  const layoutBtns = (['overlay', 'docked'] as const).map((l) => {
    const active = layout === l;
    return {
      l,
      label: l === 'overlay' ? 'Overlay' : 'Docked',
      bg: active ? '#fff' : 'transparent',
      fg: active ? '#15171a' : '#8b9298',
      shadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
    };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '18px', padding: '0 20px', height: '60px', background: '#fff', borderBottom: '1px solid #e7e8ea', flex: 'none', zIndex: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: '#06a96b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '16px' }}>S</div>
        <span style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.02em' }}>Screenr</span>
        <span style={{ fontSize: '11px', color: '#98a0a8', padding: '3px 7px', background: '#f4f5f6', borderRadius: '5px', letterSpacing: '0.03em' }}>DEMO DATA</span>
      </div>

      <div style={{ position: 'relative', flex: 1, maxWidth: '340px' }}>
        <HInput
          value={search}
          onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
          placeholder="Search ticker or company…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', border: '1px solid #e7e8ea', borderRadius: '9px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: '#fafbfb' }}
          focusStyle={{ borderColor: '#06a96b', background: '#fff' }}
        />
        <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: '#aab0b6', fontSize: '14px' }}>⌕</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: '#f4f5f6', padding: '3px', borderRadius: '9px' }}>
        {layoutBtns.map((lb) => (
          <button
            key={lb.l}
            onClick={() => setLayout(lb.l)}
            style={{ padding: '6px 13px', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: lb.bg, color: lb.fg, boxShadow: lb.shadow }}
          >
            {lb.label}
          </button>
        ))}
      </div>
    </div>
  );
}
