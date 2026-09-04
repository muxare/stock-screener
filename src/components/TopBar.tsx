import { useScreener } from '../store';
import { HInput, HButton } from './ui/Hoverable';

export function TopBar() {
  const search = useScreener((s) => s.search);
  const onSearch = useScreener((s) => s.onSearch);
  const devImportAvailable = useScreener((s) => s.devImport.available);
  const openDevImport = useScreener((s) => s.openDevImport);
  const openFanBacktest = useScreener((s) => s.openFanBacktest);
  const dbSelector = useScreener((s) => s.dbSelector);
  const selectDatabase = useScreener((s) => s.selectDatabase);

  const dbName = (p: string) => p.split(/[\\/]/).pop() || p;
  const sourceBadge = dbSelector.activeKind === 'sqlite' && dbSelector.activePath
    ? dbName(dbSelector.activePath)
    : 'DEMO DATA';
  const dbValue = dbSelector.activeKind === 'sqlite' && dbSelector.activePath ? dbSelector.activePath : '';

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
          focusStyle={{ border: '1px solid #06a96b', background: '#fff' }}
        />
        <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: '#aab0b6', fontSize: '14px' }}>⌕</span>
      </div>

      <div style={{ flex: 1 }} />

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

      {devImportAvailable && (
        <HButton
          onClick={openDevImport}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '9px', background: '#fff', color: '#5b6168', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
          title="Load CSV market data into the dev database"
        >
          <span style={{ fontSize: '13px' }}>↥</span> Import data
        </HButton>
      )}

      <HButton
        onClick={openFanBacktest}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '9px', background: '#fff', color: '#5b6168', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
        title="Backtest fan entry signals across the universe"
      >
        <span style={{ fontSize: '13px' }}>⟳</span> Backtest
      </HButton>
    </div>
  );
}
