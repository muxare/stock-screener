import { useMemo } from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { useScreener, type Row } from '../store';
import { HButton, HDiv } from './ui/Hoverable';
import { Spark } from './ui/Spark';

const GRID = '156px 92px 84px 62px 86px 78px 74px 96px 104px 92px';

// header column spec — mirrors POC renderVals `cols` (lines 1863–1883). `key`
// drives store sorting; null `key` columns (Trend, 40d) are not sortable.
type Col = { key: string | null; label: string; align: 'left' | 'right'; title: string };
const COLS: Col[] = [
  { key: 'ticker', label: 'Ticker', align: 'left', title: 'Symbol & company — click to sort' },
  { key: 'price', label: 'Last', align: 'right', title: 'Last price' },
  { key: 'changePct', label: 'Chg', align: 'right', title: 'Change today (%)' },
  { key: 'rsi', label: 'RSI', align: 'right', title: 'Relative Strength Index (14)' },
  { key: 'macdHist', label: 'MACD', align: 'right', title: 'MACD histogram' },
  { key: 'stochK', label: 'Stoch', align: 'right', title: 'Stochastic RSI %K' },
  { key: 'relVol', label: 'RelVol', align: 'right', title: 'Volume vs 20-day average' },
  { key: null, label: 'Trend', align: 'right', title: 'EMA trend stack (20/50/200)' },
  { key: 'pct52w', label: '52w', align: 'right', title: 'Position within the 52-week range' },
  { key: null, label: '40d', align: 'right', title: '40-day price trend' },
];

const col = (c: number) => (c >= 0 ? '#06a96b' : '#e23d3d');

export function Results() {
  // primitive deps for derived selectors (read via getState() inside useMemo).
  // The matched rows come from the screening service (SAD#4.2) via the store;
  // `screen` changes whenever a /screen call lands.
  const screen = useScreener((s) => s.screen);
  const screenError = useScreener((s) => s.screenError);
  const screenLoading = useScreener((s) => s.screenLoading);
  const retry = useScreener((s) => s.retry);
  const universeSize = useScreener((s) => s.universeSize);
  const sectorList = useScreener((s) => s.sectorList);
  const search = useScreener((s) => s.search);
  const sectorFilter = useScreener((s) => s.sectorFilter);
  const sortKey = useScreener((s) => s.sortKey);
  const sortDir = useScreener((s) => s.sortDir);
  const pinned = useScreener((s) => s.pinned);
  const selected = useScreener((s) => s.selected);
  const compareSel = useScreener((s) => s.compareSel);
  const density = useScreener((s) => s.density);
  const heatmapOpen = useScreener((s) => s.heatmapOpen);

  // actions
  const setSort = useScreener((s) => s.setSort);
  const onSector = useScreener((s) => s.onSector);
  const setDensity = useScreener((s) => s.setDensity);
  const toggleHeatmap = useScreener((s) => s.toggleHeatmap);
  const openBacktest = useScreener((s) => s.openBacktest);
  const selectStock = useScreener((s) => s.selectStock);
  const togglePin = useScreener((s) => s.togglePin);
  const toggleCompare = useScreener((s) => s.toggleCompare);

  const rows = useMemo(
    () => useScreener.getState().filteredStocks(),
    [screen, search, sectorFilter, sortKey, sortDir, pinned],
  );

  // screenList (pre sector/search) for sector heatmap counts
  const screenList = useMemo(
    () => useScreener.getState().screenList(),
    [screen],
  );

  const matchCount = rows.length;
  const ofTotal = ' of ' + universeSize;

  const sectors = useMemo(
    () => [
      { value: 'all', label: 'All sectors' },
      ...sectorList.map((x) => ({ value: x, label: x })),
    ],
    [sectorList],
  );

  // sector heatmap — renderVals lines 1907–1917
  const heatItems = useMemo(() => {
    const heatRaw: Record<string, number> = {};
    for (const s of screenList) heatRaw[s.sector] = (heatRaw[s.sector] || 0) + 1;
    const heatMax = Math.max(1, ...Object.values(heatRaw));
    return sectorList.map((sec) => {
      const cnt = heatRaw[sec] || 0;
      const active = sectorFilter === sec;
      return {
        sector: sec,
        count: cnt,
        barW: ((cnt / heatMax) * 100).toFixed(1) + '%',
        active,
        barBg: active ? '#06a96b' : cnt === 0 ? '#e7e8ea' : '#9fd9c0',
        labelColor: active ? '#06865a' : '#6b7280',
        onClick: () => onSector(active ? 'all' : sec),
      };
    });
  }, [screenList, sectorList, sectorFilter, onSector]);

  // tanstack column model — drives the header; data comes pre-sorted from store
  const columnHelper = createColumnHelper<Row>();
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => COLS.map((c, i) => columnHelper.display({ id: c.key ?? `_col${i}`, header: c.label })) as ColumnDef<Row, unknown>[],
    [columnHelper],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  const pinnedSet = new Set(pinned);
  const compareSet = new Set(compareSel);
  const rowPad = density === 'compact' ? '7px' : '12px';
  const comfBg = density === 'comfortable' ? '#fff' : 'transparent';
  const comfFg = density === 'comfortable' ? '#15171a' : '#8b9298';
  const compBg = density === 'compact' ? '#fff' : 'transparent';
  const compFg = density === 'compact' ? '#15171a' : '#8b9298';

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 20px', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px' }}>
          <span style={{ fontSize: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{matchCount}</span>
          <span style={{ fontSize: '13px', color: '#8b9298' }}>matches{ofTotal}</span>
        </div>
        <div style={{ flex: 1 }} />
        <HButton onClick={() => toggleHeatmap()} style={{ padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '8px', background: '#fff', color: '#15171a', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f5f6f7' }}>Sectors</HButton>
        <HButton onClick={() => openBacktest()} style={{ padding: '7px 12px', border: '1px solid #e7e8ea', borderRadius: '8px', background: '#fff', color: '#15171a', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#f5f6f7' }}>Backtest</HButton>
        <select value={sectorFilter} onChange={(e) => onSector(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #e7e8ea', borderRadius: '8px', fontSize: '12.5px', fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
          {sectors.map((se) => (
            <option key={se.value} value={se.value}>{se.label}</option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: '#eceef0', padding: '3px', borderRadius: '8px' }}>
          <button onClick={() => setDensity('comfortable')} style={{ padding: '5px 10px', border: 'none', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: comfBg, color: comfFg }}>Comfortable</button>
          <button onClick={() => setDensity('compact')} style={{ padding: '5px 10px', border: 'none', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: compBg, color: compFg }}>Compact</button>
        </div>
      </div>

      {/* service-unavailable banner — with a Retry that re-fetches universe facts
          and re-runs the screen, so a load-time outage is recoverable without an
          unrelated rule edit (STORY-027). */}
      {screenError && (
        <div style={{ margin: '0 20px 12px', border: '1px solid #f3d9b8', borderRadius: '11px', background: '#fff8ef', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b3641a', flex: 'none' }}>Offline</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: '12.5px', color: '#8a6321' }}>{screenError}</div>
          <button
            onClick={() => void retry()}
            disabled={screenLoading}
            style={{ flex: 'none', padding: '6px 14px', border: '1px solid #d9a85a', borderRadius: '8px', background: screenLoading ? '#f1e3cd' : '#fff', color: '#8a6321', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit', cursor: screenLoading ? 'default' : 'pointer' }}
          >
            {screenLoading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* sector heatmap */}
      {heatmapOpen && (
        <div style={{ margin: '0 20px 12px', border: '1px solid #e7e8ea', borderRadius: '11px', background: '#fff', padding: '14px 16px' }}>
          <div style={{ fontSize: '11px', color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: '11px' }}>Matches by sector · active screen</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px 22px' }}>
            {heatItems.map((hi) => (
              <button key={hi.sector} onClick={hi.onClick} style={{ textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: hi.labelColor }}>{hi.sector}</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: hi.labelColor }}>{hi.count}</span>
                </div>
                <div style={{ height: '6px', background: '#f1f2f3', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: hi.barW, background: hi.barBg, borderRadius: '3px' }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* results grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px 20px', minHeight: 0 }}>
        <div style={{ minWidth: '920px' }}>
          {/* header */}
          {table.getHeaderGroups().map((hg) => (
            <div key={hg.id} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '0 14px', height: '38px', borderBottom: '1.5px solid #e7e8ea', position: 'sticky', top: 0, background: '#f4f5f6', zIndex: 2 }}>
              {hg.headers.map((header, i) => {
                const c = COLS[i];
                const active = c.key != null && sortKey === c.key;
                const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
                return (
                  <button
                    key={header.id}
                    onClick={() => { if (c.key) setSort(c.key); }}
                    title={c.title}
                    style={{ textAlign: c.align, border: 'none', background: 'none', cursor: c.key ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: '10.5px', fontWeight: 600, color: active ? '#15171a' : '#9aa1a8', textTransform: 'uppercase', letterSpacing: '0.05em', padding: 0, display: 'flex', gap: '3px', justifyContent: c.align === 'left' ? 'flex-start' : 'flex-end' }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}{arrow}
                  </button>
                );
              })}
            </div>
          ))}
          {/* rows */}
          {table.getRowModel().rows.map((row) => {
            const s = row.original;
            const tr = useScreener.getState().trendOf(s);
            const isSelected = s.ticker === selected;
            const isPinned = pinnedSet.has(s.ticker);
            const isCompared = compareSet.has(s.ticker);
            return (
              <HDiv
                key={s.ticker}
                onClick={() => selectStock(s.ticker)}
                style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: `${rowPad} 14px`, borderBottom: '1px solid #eef0f1', cursor: 'pointer', background: isSelected ? '#eafaf3' : '#fff', borderLeft: `2.5px solid ${isSelected ? '#06a96b' : isPinned ? '#e0a23c' : 'transparent'}` }}
                hoverStyle={{ background: '#f0f7f4' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                  <button onClick={(e) => { e.stopPropagation(); togglePin(s.ticker); }} title="Pin to top" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: '14px', lineHeight: 1, color: isPinned ? '#e0a23c' : '#cfd4d8', flex: 'none' }}>{isPinned ? '★' : '☆'}</button>
                  <button onClick={(e) => { e.stopPropagation(); toggleCompare(s.ticker); }} title="Add to compare" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: '12px', lineHeight: 1, color: isCompared ? '#2b5bbf' : '#cfd4d8', flex: 'none' }}>{isCompared ? '◉' : '○'}</button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
                    <span style={{ fontSize: '13.5px', fontWeight: 700, letterSpacing: '-0.01em' }}>{s.ticker}</span>
                    <span style={{ fontSize: '11px', color: '#9aa1a8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                  </div>
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>${s.price.toFixed(2)}</span>
                <span style={{ fontSize: '12.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: col(s.changePct) }}>{(s.changePct >= 0 ? '↑ +' : '↓ ') + s.changePct.toFixed(2) + '%'}</span>
                <span style={{ fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: s.rsi > 70 ? '#e23d3d' : s.rsi < 30 ? '#06a96b' : '#6b7280' }}>{s.rsi.toFixed(0)}</span>
                <span style={{ fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: col(s.macdHist) }}>{s.macdHist.toFixed(2)}</span>
                <span style={{ fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: s.stochK > 80 ? '#e23d3d' : s.stochK < 20 ? '#06a96b' : '#6b7280' }}>{s.stochK.toFixed(0)}</span>
                <span style={{ fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', textAlign: 'right', fontWeight: s.relVol > 1.5 ? 700 : 400, color: s.relVol > 1.5 ? '#06a96b' : '#15171a' }}>{s.relVol.toFixed(2) + '×'}</span>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '20px', background: tr[2], color: tr[1] }}>{tr[0]}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '6px' }}>
                  <div style={{ position: 'relative', height: '5px', background: '#eceef0', borderRadius: '3px' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(2, Math.min(98, s.pct52w)).toFixed(0)}%`, background: '#cdd3d8', borderRadius: '3px' }} />
                    <div style={{ position: 'absolute', left: `${Math.max(2, Math.min(98, s.pct52w)).toFixed(0)}%`, top: '50%', width: '7px', height: '7px', borderRadius: '50%', background: '#15171a', transform: 'translate(-50%,-50%)' }} />
                  </div>
                  <span style={{ fontSize: '11px', color: '#aab0b6', textAlign: 'right' }}>{s.pct52w.toFixed(0) + '% of 52w'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingLeft: '6px' }}><Spark values={s.sparkline} /></div>
              </HDiv>
            );
          })}
          {rows.length === 0 && (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: '#aab0b6', fontSize: '14px' }}>No stocks match these filters. Loosen a rule or pick another preset.</div>
          )}
        </div>
      </div>
    </div>
  );
}
