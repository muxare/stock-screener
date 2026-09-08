import { useMemo } from 'react';
import { useScreener } from '../store';
import type { FanRow, FanSignalRow } from '../store';
import { FAN_ENTER_LOOKBACK, FAN_NEAR_MARGIN } from '../lib/fan';
import { filtersActive, filterFanRows } from '../lib/filters';
import { filterSignalRows, fmtTargetWindow } from '../lib/fanSignals';
import { strategyNameOf } from '../lib/strategy/presets';
import { HDiv } from './ui/Hoverable';
import { Spark } from './ui/Spark';
import { Disclosure } from './ui/Disclosure';

const GRID = '132px 1fr 88px 72px 86px 86px 86px 86px 84px 92px';
const col = (c: number) => (c >= 0 ? '#06a96b' : '#e23d3d');
const fin = (v: number) => Number.isFinite(v);
const nf = (v: number, d: number, suf = '') => (fin(v) ? v.toFixed(d) + suf : '—');
const gapPct = (g: number) => (fin(g) ? (g * 100).toFixed(2) + '%' : '—');

const HEAD = ['Ticker', 'Name', 'Last', 'Chg', 'EMA18', 'EMA50', 'EMA100', 'EMA200', 'Gap', '40d'];
const HEAD_HELP: Record<string, string> = {
  Chg: 'change-pct', EMA18: 'ema', EMA50: 'ema', EMA100: 'ema', EMA200: 'ema', Gap: 'worst-gap', '40d': 'sparkline',
  Entry: 'entry', Stop: 'stop', 'R (risk)': 'r', 'Target window': 'target-window', Age: 'entry-age',
};

function FanTable({
  rows,
  selected,
  onSelect,
  empty,
}: {
  rows: FanRow[];
  selected: string | null;
  onSelect: (t: string) => void;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '36px 20px', color: '#98a0a8', fontSize: 13, textAlign: 'center' }}>{empty}</div>
    );
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 0, padding: '0 16px', height: 34, alignItems: 'center', borderBottom: '1px solid #eef0f1', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#98a0a8' }}>
        {HEAD.map((h, i) => (
          <div key={h} data-help={HEAD_HELP[h]} style={{ textAlign: i === 0 || i === 1 ? 'left' : 'right' }}>{h}</div>
        ))}
      </div>
      {rows.map((r) => {
        const active = selected === r.ticker;
        return (
          <HDiv
            key={r.ticker}
            onClick={() => onSelect(r.ticker)}
            title={`${r.ticker} — click for candlestick chart`}
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              gap: 0,
              padding: '0 16px',
              height: 44,
              alignItems: 'center',
              cursor: 'pointer',
              background: active ? '#eafaf3' : '#fff',
              borderBottom: '1px solid #f4f5f6',
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
            }}
            hoverStyle={{ background: active ? '#eafaf3' : '#f7f8f8' }}
          >
            <div style={{ fontWeight: 700 }}>{r.ticker}</div>
            <div style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <div style={{ textAlign: 'right' }}>{nf(r.price, 2)}</div>
            <div style={{ textAlign: 'right', color: col(r.changePct), fontWeight: 600 }}>{nf(r.changePct, 2, '%')}</div>
            <div style={{ textAlign: 'right' }}>{nf(r.ema18, 2)}</div>
            <div style={{ textAlign: 'right' }}>{nf(r.ema50, 2)}</div>
            <div style={{ textAlign: 'right' }}>{nf(r.ema100, 2)}</div>
            <div style={{ textAlign: 'right' }}>{nf(r.ema200, 2)}</div>
            <div style={{ textAlign: 'right', color: r.worstGap >= 0 ? '#06865a' : '#b06a00', fontWeight: 600 }}>{gapPct(r.worstGap)}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Spark values={r.sparkline} /></div>
          </HDiv>
        );
      })}
    </div>
  );
}

const SIG_GRID = '120px 1fr 74px 62px 78px 78px 104px 176px 56px';
const SIG_HEAD = ['Ticker', 'Name', 'Last', 'Chg', 'Entry', 'Stop', 'R (risk)', 'Target window', 'Age'];

function SignalTable({
  rows,
  selected,
  onSelect,
  empty,
}: {
  rows: FanSignalRow[];
  selected: string | null;
  onSelect: (t: string) => void;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '36px 20px', color: '#98a0a8', fontSize: 13, textAlign: 'center' }}>{empty}</div>
    );
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: SIG_GRID, gap: 0, padding: '0 16px', height: 34, alignItems: 'center', borderBottom: '1px solid #eef0f1', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#98a0a8' }}>
        {SIG_HEAD.map((h, i) => (
          <div key={h} data-help={HEAD_HELP[h]} style={{ textAlign: i === 0 || i === 1 ? 'left' : 'right' }}>{h}</div>
        ))}
      </div>
      {rows.map((r) => {
        const active = selected === r.ticker;
        const age = r.barsAgo === 0 ? 'today' : `${r.barsAgo}d`;
        return (
          <HDiv
            key={r.ticker}
            onClick={() => onSelect(r.ticker)}
            title={`${r.ticker} — entry ${r.entryDate ?? 'latest bar'}, open ${r.openR >= 0 ? '+' : ''}${nf(r.openR, 2)}R. Click for the chart.`}
            style={{
              display: 'grid',
              gridTemplateColumns: SIG_GRID,
              gap: 0,
              padding: '0 16px',
              height: 44,
              alignItems: 'center',
              cursor: 'pointer',
              background: active ? '#eafaf3' : '#fff',
              borderBottom: '1px solid #f4f5f6',
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
            }}
            hoverStyle={{ background: active ? '#eafaf3' : '#f7f8f8' }}
          >
            <div style={{ fontWeight: 700 }}>{r.ticker}</div>
            <div style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <div style={{ textAlign: 'right' }}>{nf(r.price, 2)}</div>
            <div style={{ textAlign: 'right', color: col(r.changePct), fontWeight: 600 }}>{nf(r.changePct, 2, '%')}</div>
            <div style={{ textAlign: 'right', fontWeight: 600 }}>{nf(r.entryPrice, 2)}</div>
            <div style={{ textAlign: 'right', color: '#b3261a' }}>{nf(r.stopPrice, 2)}</div>
            <div style={{ textAlign: 'right' }}>
              {nf(r.riskPerShare, 2)}<span style={{ color: '#98a0a8' }}> · {nf(r.riskPct, 1)}%</span>
            </div>
            <div style={{ textAlign: 'right', color: '#06865a', fontWeight: 600 }}>{fmtTargetWindow(r)}</div>
            <div style={{ textAlign: 'right', color: '#8b9298' }}>{age}</div>
          </HDiv>
        );
      })}
    </div>
  );
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
          <header style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f1f2' }}>
            <div data-help="live-entry" style={{ fontSize: 15, fontWeight: 700 }}>Entries · {label}</div>
            <div style={{ fontSize: 12, color: '#8b9298', marginTop: 3 }}>
              {countLabel}
              {' · '}<span data-help="r">1R stop</span>, <span data-help="target-window">2.5–3R exit window</span>
            </div>
          </header>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <SignalTable
              rows={rows}
              selected={selected}
              onSelect={selectStock}
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
          <header style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f1f2' }}>
            <div data-help="fan" style={{ fontSize: 15, fontWeight: 700 }}>EMA fan</div>
            <div style={{ fontSize: 12, color: '#8b9298', marginTop: 3 }}>
              {screenLoading ? 'Screening…' : matchLabel}
              {' · '}<span data-help="fan">18 &gt; 50 &gt; 100 &gt; 200</span>
            </div>
          </header>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <FanTable
              rows={matches}
              selected={selected}
              onSelect={selectStock}
              empty={filtered ? 'No matches pass the current filters.' : 'No names currently stacked 18 > 50 > 100 > 200.'}
            />
          </div>
        </section>

        <section style={{ background: '#fff', borderRadius: 12, border: '1px solid #e7e8ea', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <header style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f1f2' }}>
            <div data-help="fan-near" style={{ fontSize: 15, fontWeight: 700 }}>Close to fan</div>
            <div style={{ fontSize: 12, color: '#8b9298', marginTop: 3 }}>
              {screenLoading ? 'Screening…' : nearLabel}
              {' · '}<span data-help="fan-near">within {(FAN_NEAR_MARGIN * 100).toFixed(1)}% and improving over {FAN_ENTER_LOOKBACK} bars</span>
            </div>
          </header>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <FanTable
              rows={near}
              selected={selected}
              onSelect={selectStock}
              empty={filtered ? 'No near names pass the current filters.' : 'No names are approaching the fan.'}
            />
          </div>
        </section>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <Disclosure />
      </div>
    </div>
  );
}
