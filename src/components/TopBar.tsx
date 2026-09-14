import { useScreener } from '../store';
import { useHelpMode } from '../help/helpMode';
import { SUMMON_LABEL } from '../help/trigger';
import { HInput, HButton } from './ui/Hoverable';

export function TopBar() {
  const { helpMode, setHelpMode } = useHelpMode();
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
        <span data-help="data-source" title={dbSelector.activePath || 'Synthetic generated dataset'} style={{ fontSize: '11px', color: '#98a0a8', padding: '3px 7px', background: '#f4f5f6', borderRadius: '5px', letterSpacing: '0.03em', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sourceBadge}</span>
      </div>

      {/* The ⌕ carries the help, not the 340 px box around it: a wrapper that
          wide is a trap the pointer falls into on its way somewhere else, and
          the glyph is the one part of a search field that is a marker rather
          than a control. */}
      <div style={{ position: 'relative', flex: 1, maxWidth: '340px' }}>
        <HInput
          value={search}
          onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
          placeholder="Search ticker or company…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 34px', border: '1px solid #e7e8ea', borderRadius: '9px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: '#fafbfb' }}
          focusStyle={{ border: '1px solid #06a96b', background: '#fff' }}
        />
        <span data-help="search" style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: '#aab0b6', fontSize: '14px', cursor: 'help' }}>⌕</span>
      </div>

      <div style={{ flex: 1 }} />

      {dbSelector.available && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title={dbSelector.error || 'Select the active market-data source'}>
          <span data-help="data-source" style={{ fontSize: '11px', color: '#98a0a8', cursor: 'help' }}>Data</span>
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
          data-help="dev-import"
          onClick={openDevImport}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '9px', background: '#fff', color: '#5b6168', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
          title="Load CSV market data into the dev database"
        >
          <span style={{ fontSize: '13px' }}>↥</span> Import data
        </HButton>
      )}

      <HButton
        data-help="backtest"
        onClick={openFanBacktest}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '9px', background: '#fff', color: '#5b6168', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        hoverStyle={{ border: '1px solid #06a96b', color: '#06865a' }}
        title="Backtest fan entry signals across the universe"
      >
        <span style={{ fontSize: '13px' }}>⟳</span> Backtest
      </HButton>

      <HButton
        data-help="help"
        type="button"
        aria-label="Help mode"
        aria-pressed={helpMode}
        onClick={() => setHelpMode(!helpMode)}
        style={{ width: 30, height: 30, padding: 0, border: `1px solid ${helpMode ? '#06a96b' : '#e7e8ea'}`, borderRadius: '50%', background: helpMode ? '#06a96b' : '#fff', color: helpMode ? '#fff' : '#98a0a8', fontSize: '14px', fontWeight: 700, cursor: 'help', fontFamily: 'inherit' }}
        hoverStyle={{ border: '1px solid #06a96b', color: helpMode ? '#fff' : '#06865a' }}
        title={helpMode
          ? 'Help mode is on — point at anything for a card. Click again or press Esc to leave'
          : `Help mode: point at anything for a card, without holding ${SUMMON_LABEL}`}
      >
        ?
      </HButton>
    </div>
  );
}
