import { useScreener } from '../store';
import { HInput, HButton } from './ui/Hoverable';

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
  const devImportAvailable = useScreener((s) => s.devImport.available);
  const openDevImport = useScreener((s) => s.openDevImport);
  const dbSelector = useScreener((s) => s.dbSelector);
  const selectDatabase = useScreener((s) => s.selectDatabase);

  // Data-source badge: synthetic shows "DEMO DATA"; a SQLite dataset shows the DB
  // file name so it's obvious which database is being screened (STORY-035).
  const dbName = (p: string) => p.split(/[\\/]/).pop() || p;
  const sourceBadge = dbSelector.activeKind === 'sqlite' && dbSelector.activePath
    ? dbName(dbSelector.activePath)
    : 'DEMO DATA';
  // <select> value: a DB path when a SQLite dataset is active, '' for synthetic.
  const dbValue = dbSelector.activeKind === 'sqlite' && dbSelector.activePath ? dbSelector.activePath : '';

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
        <span title={dbSelector.activePath || 'Synthetic generated dataset'} style={{ fontSize: '11px', color: '#98a0a8', padding: '3px 7px', background: '#f4f5f6', borderRadius: '5px', letterSpacing: '0.03em', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sourceBadge}</span>
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

      {/* Dev-only DB-selector (STORY-035). Switches the active dataset at runtime
          — a chosen SQLite DB or the synthetic generator. Same DEV_TOOLS gate as
          the import button, so it never appears in a production build. */}
      {dbSelector.available && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title={dbSelector.error || 'Select the active market-data source'}>
          <span style={{ fontSize: '11px', color: '#98a0a8' }}>Data</span>
          <select
            value={dbValue}
            disabled={dbSelector.switching}
            onChange={(e) => void selectDatabase(e.target.value === '' ? null : e.target.value)}
            style={{ padding: '7px 10px', border: `1px solid ${dbSelector.error ? '#f5c6c0' : '#e7e8ea'}`, borderRadius: '9px', background: dbSelector.switching ? '#f4f5f6' : '#fff', color: '#5b6168', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit', cursor: dbSelector.switching ? 'default' : 'pointer', maxWidth: '220px' }}
          >
            <option value="">Synthetic (generated)</option>
            {dbSelector.databases.map((d) => (
              <option key={d.path} value={d.path} disabled={!d.valid} title={d.path}>
                {d.name}{d.valid ? (d.instruments != null ? ` (${d.instruments})` : '') : ' — invalid'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Dev-only EOD import (STORY-031). Rendered only when the service reports
          DEV_TOOLS on, so it never appears in a production build. */}
      {devImportAvailable && (
        <HButton
          onClick={openDevImport}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '9px', background: '#fff', color: '#5b6168', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          hoverStyle={{ borderColor: '#06a96b', color: '#06865a' }}
          title="Load CSV market data into the dev database"
        >
          <span style={{ fontSize: '13px' }}>↥</span> Import data
        </HButton>
      )}

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
