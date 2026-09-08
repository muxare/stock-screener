import { useMemo } from 'react';
import { useScreener } from '../store';
import type { FanRow, FanSignalRow } from '../store';
import { FAN_ENTER_LOOKBACK, FAN_NEAR_MARGIN } from '../lib/fan';
import { filtersActive, filterFanRows } from '../lib/filters';
import { filterSignalRows, fmtTargetWindow } from '../lib/fanSignals';
import { strategyNameOf } from '../lib/strategy/presets';
import type { FieldId } from '../lib/screen/fields';
import type { SortState } from '../lib/screen/sort';
import type { ScreenView } from '../lib/screen/columns';
import { ScreenTable, type ExtraColumn } from './table/ScreenTable';
import { ColumnChooser } from './table/ColumnChooser';
import { Disclosure } from './ui/Disclosure';

const fin = (v: number) => Number.isFinite(v);
const nf = (v: number, d: number, suf = '') => (fin(v) ? v.toFixed(d) + suf : '—');

/** The entries list's own columns — everything derived from the simulated trade. */
const SIGNAL_COLUMNS: ExtraColumn<FanSignalRow>[] = [
  {
    id: 'entryPrice', label: 'Entry', width: '78px', help: 'entry',
    sortValue: (r) => r.entryPrice,
    render: (r) => <span style={{ fontWeight: 600 }}>{nf(r.entryPrice, 2)}</span>,
  },
  {
    id: 'stopPrice', label: 'Stop', width: '78px', help: 'stop',
    sortValue: (r) => r.stopPrice,
    render: (r) => <span style={{ color: '#b3261a' }}>{nf(r.stopPrice, 2)}</span>,
  },
  {
    id: 'riskPerShare', label: 'R (risk)', width: '104px', help: 'r',
    sortValue: (r) => r.riskPct,
    render: (r) => (
      <>{nf(r.riskPerShare, 2)}<span style={{ color: '#98a0a8' }}> · {nf(r.riskPct, 1)}%</span></>
    ),
  },
  {
    id: 'targetWindow', label: 'Target window', width: '176px', help: 'target-window',
    sortValue: (r) => r.targetLoPrice,
    render: (r) => <span style={{ color: '#06865a', fontWeight: 600 }}>{fmtTargetWindow(r)}</span>,
  },
  {
    id: 'barsAgo', label: 'Age', width: '56px', help: 'entry-age',
    sortValue: (r) => r.barsAgo,
    render: (r) => <span style={{ color: '#8b9298' }}>{r.barsAgo === 0 ? 'today' : `${r.barsAgo}d`}</span>,
  },
];

/** The ⚙ + the sort hint shared by every list header. */
function ListHeader({
  view,
  helpId,
  title,
  subtitle,
}: {
  view: ScreenView;
  helpId: string;
  title: string;
  subtitle: React.ReactNode;
}) {
  const columns = useScreener((s) => s.columns[view]);
  const toggleColumn = useScreener((s) => s.toggleColumn);
  const resetColumns = useScreener((s) => s.resetColumns);
  return (
    <header style={{ padding: '12px 14px 9px', borderBottom: '1px solid #f0f1f2', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div data-help={helpId} style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#8b9298', marginTop: 3 }}>{subtitle}</div>
      </div>
      <ColumnChooser
        columns={columns}
        onToggle={(id: FieldId) => toggleColumn(view, id)}
        onReset={() => resetColumns(view)}
      />
    </header>
  );
}

function useViewSort(view: ScreenView): [SortState, (next: SortState) => void] {
  const sort = useScreener((s) => s.sort[view]);
  const setSort = useScreener((s) => s.setSort);
  return [sort, (next) => setSort(view, next)];
}

function SignalList() {
  const strategy = useScreener((s) => s.signalStrategy);
  const strategies = useScreener((s) => s.strategies);
  const signalsAll = useScreener((s) => s.signals);
  const search = useScreener((s) => s.search);
  const filters = useScreener((s) => s.filters);
  const selected = useScreener((s) => s.selected);
  const loading = useScreener((s) => s.signalsLoading);
  const error = useScreener((s) => s.signalsError);
  const universeSize = useScreener((s) => s.universeSize);
  const selectStock = useScreener((s) => s.selectStock);
  const runSignals = useScreener((s) => s.runSignals);
  const columns = useScreener((s) => s.columns.entries);
  const [sort, onSort] = useViewSort('entries');

  const rows = useMemo(
    () => filterSignalRows(signalsAll, search, filters.sector, filters.minPrice),
    [signalsAll, search, filters.sector, filters.minPrice],
  );

  if (strategy === '') return null;
  const label = strategyNameOf(strategy, strategies);
  const shown = rows.length;
  const total = signalsAll.length;
  const clientFiltered = filters.sector !== '' || filters.minPrice > 0 || search.trim() !== '';
  const countLabel = loading
    ? 'Scanning universe for open entries…'
    : clientFiltered && shown !== total
      ? `${shown} of ${total} open entries`
      : `${total} open ${total === 1 ? 'entry' : 'entries'} of ${universeSize}`;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#f4f5f6' }}>
      {error && (
        <div role="alert" style={{ margin: 16, padding: '12px 14px', background: '#fdeceb', border: '1px solid #f5c6c0', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: 13, color: '#b3261a' }}>{error}</div>
          <button onClick={() => void runSignals()} style={{ padding: '7px 14px', border: '1px solid #f5c6c0', borderRadius: 8, background: '#fff', color: '#b3261a', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <section style={{ height: '100%', background: '#fff', borderRadius: 12, border: '1px solid #e7e8ea', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <ListHeader
            view="entries"
            helpId="live-entry"
            title={`Entries · ${label}`}
            subtitle={
              <>
                {countLabel}
                {' · '}<span data-help="r">1R stop</span>, <span data-help="target-window">2.5–3R exit window</span>
              </>
            }
          />
          <div style={{ flex: 1, overflow: 'auto' }}>
            <ScreenTable<FanSignalRow>
              rows={rows}
              columns={columns}
              extra={SIGNAL_COLUMNS}
              extraAfter="changePct"
              sort={sort}
              onSort={onSort}
              selected={selected}
              onSelect={selectStock}
              rowTitle={(r) => `${r.ticker} — entry ${r.entryDate ?? 'latest bar'}, open ${r.openR >= 0 ? '+' : ''}${nf(r.openR, 2)}R. Click for the chart.`}
              empty={loading ? 'Scanning…' : clientFiltered ? 'No open entries pass the current filters.' : `No names currently have an open ${label} entry.`}
            />
          </div>
        </section>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <Disclosure note="A live entry is a strategy fill whose simulated trade (1R structural stop, no early management) is still open on the latest bar. Entry, stop, and the 2.5–3R target window are illustrative — no costs, slippage, or gaps." />
      </div>
    </div>
  );
}

export function FanLists() {
  const signalStrategy = useScreener((s) => s.signalStrategy);
  const matchesAll = useScreener((s) => s.matches);
  const nearAll = useScreener((s) => s.near);
  const search = useScreener((s) => s.search);
  const filters = useScreener((s) => s.filters);
  const selected = useScreener((s) => s.selected);
  const screenError = useScreener((s) => s.screenError);
  const screenLoading = useScreener((s) => s.screenLoading);
  const universeSize = useScreener((s) => s.universeSize);
  const retry = useScreener((s) => s.retry);
  const selectStock = useScreener((s) => s.selectStock);
  const columns = useScreener((s) => s.columns.fan);
  const [sort, onSort] = useViewSort('fan');

  const matches = useMemo(
    () => filterFanRows(matchesAll, search, filters),
    [matchesAll, search, filters],
  );
  const near = useMemo(
    () => filterFanRows(nearAll, search, filters),
    [nearAll, search, filters],
  );
  const matchesTotal = matchesAll.length;
  const nearTotal = nearAll.length;

  const filtered = filtersActive(filters);
  const matchLabel = filtered && matches.length !== matchesTotal
    ? `${matches.length} of ${matchesTotal} shown`
    : `${matches.length} match${matches.length === 1 ? '' : 'es'} of ${universeSize}`;
  const nearLabel = filtered && near.length !== nearTotal
    ? `${near.length} of ${nearTotal} shown`
    : `${near.length} approaching the stack`;

  if (signalStrategy !== '') return <SignalList />;

  const table = (rows: FanRow[], empty: string) => (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <ScreenTable<FanRow>
        rows={rows}
        columns={columns}
        sort={sort}
        onSort={onSort}
        selected={selected}
        onSelect={selectStock}
        empty={empty}
      />
    </div>
  );

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#f4f5f6' }}>
      {screenError && (
        <div role="alert" style={{ margin: 16, padding: '12px 14px', background: '#fdeceb', border: '1px solid #f5c6c0', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: 13, color: '#b3261a' }}>{screenError}</div>
          <button onClick={() => void retry()} style={{ padding: '7px 14px', border: '1px solid #f5c6c0', borderRadius: 8, background: '#fff', color: '#b3261a', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 12 }}>
        <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e7e8ea', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <ListHeader
            view="fan"
            helpId="fan"
            title="EMA fan"
            subtitle={
              <>
                {screenLoading ? 'Screening…' : matchLabel}
                {' · '}<span data-help="fan">18 &gt; 50 &gt; 100 &gt; 200</span>
              </>
            }
          />
          {table(matches, filtered ? 'No matches pass the current filters.' : 'No names currently stacked 18 > 50 > 100 > 200.')}
        </section>

        <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e7e8ea', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <ListHeader
            view="fan"
            helpId="fan-near"
            title="Close to fan"
            subtitle={
              <>
                {screenLoading ? 'Screening…' : nearLabel}
                {' · '}<span data-help="fan-near">within {(FAN_NEAR_MARGIN * 100).toFixed(1)}% and improving over {FAN_ENTER_LOOKBACK} bars</span>
              </>
            }
          />
          {table(near, filtered ? 'No near names pass the current filters.' : 'No names are approaching the fan.')}
        </section>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <Disclosure />
      </div>
    </div>
  );
}
