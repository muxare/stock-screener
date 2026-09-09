import { useMemo, type ReactNode } from 'react';
import { useScreener } from '../store';
import type { FanRow, FanSignalRow } from '../store';
import { FAN_ENTER_LOOKBACK, FAN_NEAR_MARGIN } from '../lib/fan';
import { clausesActive, filterRows } from '../lib/screen/filters';
import { filterSignalRows, fmtTargetWindow } from '../lib/fanSignals';
import { strategyNameOf } from '../lib/strategy/presets';
import type { FieldId } from '../lib/screen/fields';
import type { SortState } from '../lib/screen/sort';
// `ScreenView` the type is the *table shape*; this file's `ScreenView` is the
// component. Aliased so the two axes stay visibly distinct (see columns.ts).
import {
  SCREEN_TABS,
  tableViewOf,
  type ScreenTab,
  type ScreenView as TableView,
} from '../lib/screen/columns';
import { ScreenTable, type ExtraColumn } from './table/ScreenTable';
import { ColumnChooser } from './table/ColumnChooser';
import { Disclosure } from './ui/Disclosure';
import { HButton } from './ui/Hoverable';

const fin = (v: number) => Number.isFinite(v);
const nf = (v: number, d: number) => (fin(v) ? v.toFixed(d) : '—');

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

const TAB_LABEL: Record<ScreenTab, { label: string; help: string }> = {
  fan: { label: 'EMA fan', help: 'fan' },
  near: { label: 'Close to fan', help: 'fan-near' },
  entries: { label: 'Entries', help: 'live-entry' },
};

/** One tab per row set; Entries is dead until a strategy is chosen. */
function TabStrip({
  tab,
  counts,
  entriesEnabled,
  onPick,
}: {
  tab: ScreenTab;
  counts: Record<ScreenTab, number>;
  entriesEnabled: boolean;
  onPick: (t: ScreenTab) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: '0 16px', background: '#fff', borderBottom: '1px solid #e7e8ea' }}>
      {SCREEN_TABS.map((id) => {
        const active = id === tab;
        const disabled = id === 'entries' && !entriesEnabled;
        return (
          <HButton
            key={id}
            disabled={disabled}
            onClick={() => onPick(id)}
            title={disabled ? 'Choose an entry strategy to scan for open entries.' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 10px 8px',
              border: 'none',
              borderBottom: `2px solid ${active ? '#06a96b' : 'transparent'}`,
              background: 'none',
              color: disabled ? '#c8ced3' : active ? '#15171a' : '#6b7280',
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              cursor: disabled ? 'default' : 'pointer',
            }}
            hoverStyle={disabled ? undefined : { color: '#15171a' }}
          >
            {/* The word, not the whole tab: `closest()` picks the innermost
                anchor, so the count badge and the tab's padding stop being
                targets for a pointer only passing through. */}
            <span data-help={TAB_LABEL[id].help}>{TAB_LABEL[id].label}</span>
            <span
              style={{
                fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                padding: '1px 6px', borderRadius: 7,
                background: active ? '#eafaf3' : '#f4f5f6',
                color: disabled ? '#c8ced3' : active ? '#06865a' : '#98a0a8',
              }}
            >
              {disabled ? '—' : counts[id]}
            </span>
          </HButton>
        );
      })}
    </div>
  );
}

/** The count sentence, the list's own rule, and the ⚙. */
function ListHeader({ view, subtitle }: { view: TableView; subtitle: ReactNode }) {
  const columns = useScreener((s) => s.columns[view]);
  const toggleColumn = useScreener((s) => s.toggleColumn);
  const resetColumns = useScreener((s) => s.resetColumns);
  return (
    <header style={{ padding: '9px 14px', borderBottom: '1px solid #f0f1f2', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#8b9298' }}>{subtitle}</div>
      <ColumnChooser
        columns={columns}
        onToggle={(id: FieldId) => toggleColumn(view, id)}
        onReset={() => resetColumns(view)}
      />
    </header>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ margin: 16, padding: '12px 14px', background: '#fdeceb', border: '1px solid #f5c6c0', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, fontSize: 13, color: '#b3261a' }}>{message}</div>
      <button onClick={onRetry} style={{ padding: '7px 14px', border: '1px solid #f5c6c0', borderRadius: 8, background: '#fff', color: '#b3261a', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>Retry</button>
    </div>
  );
}

function useViewSort(view: TableView): [SortState, (next: SortState) => void] {
  const sort = useScreener((s) => s.sort[view]);
  const setSort = useScreener((s) => s.setSort);
  return [sort, (next) => setSort(view, next)];
}

/**
 * ScreenView — the screener's list half: the view tabs and the one full-width
 * table under them.
 *
 * All three row sets (fan matches, near misses, live entries) are filtered on
 * every render and their counts sit on the tabs, so switching tab is a repaint
 * rather than a re-screen. `near` shares the fan view's columns and sort; the
 * entries tab is the only one with its own table shape, and adds the
 * entry / stop / R / target-window / age block through `extra`.
 */
export function ScreenView() {
  const view = useScreener((s) => s.view);
  const setView = useScreener((s) => s.setView);
  const signalStrategy = useScreener((s) => s.signalStrategy);
  const strategies = useScreener((s) => s.strategies);
  const matchesAll = useScreener((s) => s.matches);
  const nearAll = useScreener((s) => s.near);
  const signalsAll = useScreener((s) => s.signals);
  const search = useScreener((s) => s.search);
  const filters = useScreener((s) => s.filters);
  const selected = useScreener((s) => s.selected);
  const screenError = useScreener((s) => s.screenError);
  const screenLoading = useScreener((s) => s.screenLoading);
  const signalsError = useScreener((s) => s.signalsError);
  const signalsLoading = useScreener((s) => s.signalsLoading);
  const universeSize = useScreener((s) => s.universeSize);
  const retry = useScreener((s) => s.retry);
  const runSignals = useScreener((s) => s.runSignals);
  const selectStock = useScreener((s) => s.selectStock);

  const matches = useMemo(() => filterRows(matchesAll, search, filters), [matchesAll, search, filters]);
  const near = useMemo(() => filterRows(nearAll, search, filters), [nearAll, search, filters]);
  const entries = useMemo(
    () => filterSignalRows(signalsAll, search, filters),
    [signalsAll, search, filters],
  );

  const entriesEnabled = signalStrategy !== '';
  // A tab can outlive the thing that enabled it (a deleted strategy, and in
  // phase 4 a saved screen), so the visible tab is derived, not trusted.
  const tab: ScreenTab = view === 'entries' && !entriesEnabled ? 'fan' : view;
  const tableView = tableViewOf(tab);
  const columns = useScreener((s) => s.columns[tableView]);
  const [sort, onSort] = useViewSort(tableView);

  // Search shrinks a list exactly as a clause does, so both count as filtering
  // for the "n of m shown" line and for the empty-list wording.
  const narrowed = clausesActive(filters) || search.trim() !== '';
  const counts: Record<ScreenTab, number> = {
    fan: matches.length,
    near: near.length,
    entries: entries.length,
  };
  const shown = counts[tab];

  const ofTotal = (total: number, whole: ReactNode) =>
    narrowed && shown !== total ? `${shown} of ${total} shown` : whole;

  let subtitle: ReactNode;
  let table: ReactNode;
  let disclosureNote: string | undefined;

  if (tab === 'entries') {
    const label = strategyNameOf(signalStrategy, strategies);
    const total = signalsAll.length;
    subtitle = (
      <>
        <strong style={{ color: '#3d4349', fontWeight: 700 }}>Entries · {label}</strong>
        {' · '}
        {signalsLoading
          ? 'Scanning universe for open entries…'
          : ofTotal(total, `${total} open ${total === 1 ? 'entry' : 'entries'} of ${universeSize}`)}
        {' · '}<span data-help="r">1R stop</span>, <span data-help="target-window">2.5–3R exit window</span>
      </>
    );
    table = (
      <ScreenTable<FanSignalRow>
        rows={entries}
        columns={columns}
        extra={SIGNAL_COLUMNS}
        extraAfter="changePct"
        sort={sort}
        onSort={onSort}
        selected={selected}
        onSelect={selectStock}
        rowTitle={(r) => `${r.ticker} — entry ${r.entryDate ?? 'latest bar'}, open ${r.openR >= 0 ? '+' : ''}${nf(r.openR, 2)}R. Click for the chart.`}
        empty={signalsLoading ? 'Scanning…' : narrowed ? 'No open entries pass the current filters.' : `No names currently have an open ${label} entry.`}
      />
    );
    disclosureNote = 'A live entry is a strategy fill whose simulated trade (1R structural stop, no early management) is still open on the latest bar. Entry, stop, and the 2.5–3R target window are illustrative — no costs, slippage, or gaps.';
  } else if (tab === 'near') {
    const total = nearAll.length;
    subtitle = (
      <>
        {screenLoading ? 'Screening…' : ofTotal(total, `${total} approaching the stack`)}
        {' · '}<span data-help="fan-near">within {(FAN_NEAR_MARGIN * 100).toFixed(1)}% and improving over {FAN_ENTER_LOOKBACK} bars</span>
      </>
    );
    table = (
      <ScreenTable<FanRow>
        rows={near}
        columns={columns}
        sort={sort}
        onSort={onSort}
        selected={selected}
        onSelect={selectStock}
        empty={narrowed ? 'No near names pass the current filters.' : 'No names are approaching the fan.'}
      />
    );
  } else {
    const total = matchesAll.length;
    subtitle = (
      <>
        {screenLoading ? 'Screening…' : ofTotal(total, `${total} match${total === 1 ? '' : 'es'} of ${universeSize}`)}
        {' · '}<span data-help="fan">18 &gt; 50 &gt; 100 &gt; 200</span>
      </>
    );
    table = (
      <ScreenTable<FanRow>
        rows={matches}
        columns={columns}
        sort={sort}
        onSort={onSort}
        selected={selected}
        onSelect={selectStock}
        empty={narrowed ? 'No matches pass the current filters.' : 'No names currently stacked 18 > 50 > 100 > 200.'}
      />
    );
  }

  const error = tab === 'entries' ? signalsError : screenError;
  const onRetry = tab === 'entries' ? () => void runSignals() : () => void retry();

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#f4f5f6' }}>
      <TabStrip tab={tab} counts={counts} entriesEnabled={entriesEnabled} onPick={setView} />

      {error && <ErrorBanner message={error} onRetry={onRetry} />}

      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <section style={{ height: '100%', background: '#fff', borderRadius: 12, border: '1px solid #e7e8ea', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <ListHeader view={tableView} subtitle={subtitle} />
          <div style={{ flex: 1, overflow: 'auto' }}>{table}</div>
        </section>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <Disclosure note={disclosureNote} />
      </div>
    </div>
  );
}
