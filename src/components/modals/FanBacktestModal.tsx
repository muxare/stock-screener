import { useState } from 'react';
import { useScreener } from '../../store';
import { HButton } from '../ui/Hoverable';
import { Disclosure } from '../ui/Disclosure';
import { fanEntryIndex } from '../../lib/fanBacktest';
import { StrategyBuilder } from './StrategyBuilder';
import { AVG_VOL_PRESETS, MARKET_CAP_PRESETS, EMA200_RISING_PRESETS } from '../../lib/filters';
import { FanTradeReview } from './FanTradeReview';
import { FanExampleChart } from './FanExampleChart';

const PAGE_SIZE = 20;

const label: React.CSSProperties = {
  fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em',
  marginBottom: 6, fontWeight: 700, display: 'block',
};
const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e7e8ea',
  borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fafbfb', outline: 'none',
};
const card: React.CSSProperties = {
  background: '#fafbfb', border: '1px solid #eef0f1', borderRadius: 10, padding: '12px 14px',
};
const nf = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
function Stat({ k, v, sub, help }: { k: string; v: string; sub?: string; help?: string }) {
  return (
    <div data-help={help} style={card}>
      <div style={{ fontSize: 10, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{k}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: '#8b9298', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function EquitySpark({ points }: { points: { date: string; equity: number }[] }) {
  if (points.length < 2) return null;
  const ys = points.map((p) => p.equity);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const w = 240;
  const h = 44;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - 3 - ((p.equity - lo) / span) * (h - 6);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const up = points[points.length - 1].equity >= points[0].equity;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={up ? '#06865a' : '#e23d3d'} strokeWidth={1.8} />
    </svg>
  );
}

export function FanBacktestModal() {
  const bt = useScreener((s) => s.fanBacktest);
  const close = useScreener((s) => s.closeFanBacktest);
  const setCfg = useScreener((s) => s.setFanBacktestConfig);
  const run = useScreener((s) => s.runFanBacktest);
  const closeReview = useScreener((s) => s.closeFanTradeReview);
  const stepReview = useScreener((s) => s.stepFanTradeReview);
  const retryDisplayed = useScreener((s) => s.retryDisplayed);
  const inspecting = bt.inspecting;
  const inspectTicker = inspecting?.ticker;
  const inspectStock = useScreener((s) => (inspectTicker ? s.displayed[inspectTicker] ?? null : null));
  const inspectStatus = useScreener((s) => (inspectTicker ? s.displayStatus[inspectTicker] : undefined));
  const [page, setPage] = useState(0);
  const entryCount = bt.result?.entries.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(entryCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);

  if (!bt.open) return null;

  const r = bt.result;
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${nf(v)}%`;
  const usd = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const usd2 = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const def = bt.config.strategy;
  const exit = def.trade.exit;
  const reason = (s: string) => s.replace(/_/g, ' ');
  const inspectIdx = inspecting && r ? fanEntryIndex(r.entries, inspecting) : -1;
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = r ? r.entries.slice(pageStart, pageStart + PAGE_SIZE) : [];

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.42)', zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: inspecting ? 900 : 1240, maxWidth: '100%',
          height: inspecting ? 'auto' : '92vh', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid #f0f1f2', flexShrink: 0 }}>
          <div data-help="backtest" style={{ fontSize: 17, fontWeight: 700 }}>Fan strategy backtest</div>
          <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 3 }}>
            Long-only. 1R under the pullback/50-EMA
            {exit.trailEma === 50
              ? ', then trail the 50 after 1R breakeven. MACD does not cut a trailed trade.'
              : exit.trailPivot
                ? ', then trail 2¢ under confirmed pivot lows. MACD does not cut a trailed trade.'
                : exit.targetWindow
                  ? ', exit at 2.5R (course target window).'
                  : `, ${exit.targetR}R target.`}
            {' '}Default is a 50-EMA tag while 18&gt;50&gt;100&gt;200. Swing account sizes each fill at 1R and stops at the window or ruin.
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexWrap: 'nowrap',
          overflow: inspecting ? 'auto' : 'hidden',
        }}>
          {inspecting ? (
            <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
              <FanTradeReview
                event={inspecting}
                stock={inspectStock}
                status={inspectStatus}
                trailEma={exit.trailPivot ? null : exit.trailEma}
                onClose={closeReview}
                onRetry={() => retryDisplayed(inspecting.ticker)}
                onPrev={() => stepReview(-1)}
                onNext={() => stepReview(1)}
                hasPrev={inspectIdx > 0}
                hasNext={inspectIdx >= 0 && inspectIdx < (r?.entries.length ?? 0) - 1}
                position={inspectIdx >= 0 && r ? `${inspectIdx + 1} / ${r.entries.length}` : null}
              />
            </div>
          ) : (
            <>
          <div style={{
            flex: '1 1 520px', minWidth: 0, minHeight: 0, overflowY: 'auto',
            padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16,
          }}>
          <StrategyBuilder def={def} disabled={bt.running} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label data-help="avg-volume" style={label}>Avg volume (20d)</label>
              <select
                value={String(bt.config.minAvgVol ?? 0)}
                disabled={bt.running}
                onChange={(e) => setCfg('minAvgVol', Number(e.target.value))}
                style={field}
                title="Same 20-day average volume floor as the main filter bar"
              >
                {AVG_VOL_PRESETS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label data-help="market-cap" style={label}>Market cap</label>
              <select
                value={String(bt.config.minMarketCap ?? 0)}
                disabled={bt.running}
                onChange={(e) => setCfg('minMarketCap', Number(e.target.value))}
                style={field}
                title="Same market-cap floor as the main filter bar. Unknown cap fails when a floor is set."
              >
                {MARKET_CAP_PRESETS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label data-help="ema200-slope" style={label}>200-EMA slope</label>
              <select
                value={String(bt.config.ema200RisingBars ?? 21)}
                disabled={bt.running}
                onChange={(e) => setCfg('ema200RisingBars', Number(e.target.value))}
                style={field}
                title="Require the 200-day average at the fill to be higher than 1, 3, or 5 months earlier. Same control as the main filter bar."
              >
                {EMA200_RISING_PRESETS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#8b9298', marginTop: -8 }}>
            Volume, cap, and 200-EMA slope match the main selection. Classic MACD (12/26/9) and Stoch RSI are recorded at entry for reference — they do not gate fills. The 18–50 MACD checkbox above is a separate entry filter.
          </div>

          <div>
            <div data-help="swing-account" style={{ ...label, marginBottom: 8 }}>Swing account</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label data-help="swing-account" style={label}>Starting cash</label>
                <select
                  value={String(bt.config.startCash ?? 10_000)}
                  disabled={bt.running}
                  onChange={(e) => setCfg('startCash', Number(e.target.value))}
                  style={field}
                >
                  <option value="5000">$5,000</option>
                  <option value="10000">$10,000</option>
                  <option value="25000">$25,000</option>
                  <option value="50000">$50,000</option>
                  <option value="100000">$100,000</option>
                </select>
              </div>
              <div>
                <label data-help="risk-per-trade" style={label}>Risk / trade</label>
                <select
                  value={String(bt.config.riskPct ?? 1)}
                  disabled={bt.running}
                  onChange={(e) => setCfg('riskPct', Number(e.target.value))}
                  style={field}
                  title="Percent of current equity risked per 1R"
                >
                  <option value="0.5">0.5%</option>
                  <option value="1">1%</option>
                  <option value="2">2%</option>
                  <option value="5">5%</option>
                </select>
              </div>
              <div>
                <label data-help="max-names" style={label}>Max names</label>
                <select
                  value={String(bt.config.maxPositions ?? 4)}
                  disabled={bt.running}
                  onChange={(e) => setCfg('maxPositions', Number(e.target.value))}
                  style={field}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                </select>
              </div>
              <div>
                <label data-help="backtest-window" style={label}>Window</label>
                <select
                  value={String(bt.config.windowMonths ?? 3)}
                  disabled={bt.running}
                  onChange={(e) => setCfg('windowMonths', Number(e.target.value))}
                  style={field}
                  title="New entries in the last N months of the dataset. Open trades may finish after the window."
                >
                  <option value="1">Last 1 month</option>
                  <option value="2">Last 2 months</option>
                  <option value="3">Last 3 months</option>
                  <option value="6">Last 6 months</option>
                  <option value="0">All dated history</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#8b9298', marginTop: 8 }}>
              Same strategy as above. Size = risk % of equity / 1R, whole shares, cash-capped. Stops when the window ends or equity hits zero.
            </div>
          </div>

          {bt.error && (
            <div role="alert" style={{ padding: '10px 12px', background: '#fdeceb', border: '1px solid #f5c6c0', borderRadius: 8, fontSize: 13, color: '#b3261a' }}>
              {bt.error}
            </div>
          )}

          {bt.running && (
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              Scanning universe… {bt.progress ? `${bt.progress.name} / ${bt.progress.total}` : 'starting'}
            </div>
          )}

          {r && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <Stat help="backtest-entries" k="Entries" v={String(r.totalEntries)} sub={`${r.stocksWithEntries} names`} />
                <Stat help="win-rate" k="Win rate" v={`${nf(r.trades.winRate, 1)}%`} sub={`${r.trades.count} trades`} />
                <Stat help="expectancy" k="Expectancy" v={`${r.trades.avgR >= 0 ? '+' : ''}${nf(r.trades.avgR, 2)}R`} sub={`median ${nf(r.trades.medianR, 2)}R`} />
                <Stat help="hit-target" k="Hit target" v={`${nf(r.trades.hitTargetPct, 1)}%`} sub={`avg hold ${nf(r.trades.avgBarsHeld, 1)} bars`} />
              </div>

              {Object.keys(r.trades.byExitReason).length > 0 && (
                <div data-help="exit-reasons" style={{ fontSize: 12, color: '#6b7280' }}>
                  Exits: {Object.entries(r.trades.byExitReason)
                    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                    .map(([k, v]) => `${reason(k)} ${v}`)
                    .join(' · ')}
                </div>
              )}

              {r.account && (
                <div>
                  <div style={{ ...label, marginBottom: 8 }}>
                    Swing account
                    {r.account.windowStart && r.account.windowEnd
                      ? ` (${r.account.windowStart} → ${r.account.windowEnd})`
                      : ''}
                    {r.account.endReason === 'ruin' ? ' — ruined' : ''}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                    <Stat
                      help="swing-account"
                      k="End equity"
                      v={usd(r.account.endEquity)}
                      sub={`from ${usd(r.account.startCash)}`}
                    />
                    <Stat
                      help={r.account.endReason === 'ruin' ? 'ruin' : 'swing-account'}
                      k="Return"
                      v={pct(r.account.returnPct)}
                      sub={r.account.endReason === 'ruin' ? 'stopped at ruin' : 'window ended'}
                    />
                    <Stat
                      help="max-drawdown"
                      k="Max DD"
                      v={`${nf(r.account.maxDrawdownPct, 1)}%`}
                      sub="on realized equity"
                    />
                    <Stat
                      help="taken-skipped"
                      k="Taken"
                      v={String(r.account.taken)}
                      sub={`${r.account.candidates} signals · skipped ${r.account.skipped.total}`}
                    />
                  </div>
                  {r.account.curve.length > 1 && (
                    <div style={{ ...card, marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div data-help="equity-curve" style={{ fontSize: 11, color: '#8b9298' }}>Equity after each exit</div>
                      <EquitySpark points={r.account.curve} />
                    </div>
                  )}
                  {r.account.skipped.total > 0 && (
                    <div data-help="taken-skipped" style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                      Skipped: no cash/size {r.account.skipped.noCash} · max names {r.account.skipped.maxPositions}
                    </div>
                  )}
                  {r.account.fills.length > 0 && (
                    <div style={{ border: '1px solid #eef0f1', borderRadius: 10, overflow: 'hidden', fontSize: 12.5, marginTop: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 56px 64px 80px 88px 18px', gap: 8, padding: '8px 12px', background: '#f7f8f8', fontWeight: 700, color: '#98a0a8', fontSize: 10.5, textTransform: 'uppercase' }}>
                        <div>Date</div><div>Name</div>
                        <div style={{ textAlign: 'right' }}>Sh</div>
                        <div style={{ textAlign: 'right' }}>R</div>
                        <div style={{ textAlign: 'right' }}>P/L</div>
                        <div style={{ textAlign: 'right' }}>Exit</div>
                        <div />
                      </div>
                      {r.account.fills.map((f) => {
                        const e = f.event;
                        return (
                          <HButton
                            key={`${e.ticker}-${e.barIndex}-acct`}
                            type="button"
                            title={`${e.ticker} — open trade chart`}
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              queueMicrotask(() => useScreener.getState().inspectFanEntry(e));
                            }}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '72px 1fr 56px 64px 80px 88px 18px',
                              gap: 8,
                              padding: '8px 12px',
                              border: 'none',
                              borderTop: '1px solid #f4f5f6',
                              borderRadius: 0,
                              width: '100%',
                              boxSizing: 'border-box',
                              background: '#fff',
                              fontFamily: 'inherit',
                              fontSize: 12.5,
                              fontVariantNumeric: 'tabular-nums',
                              textAlign: 'left',
                              cursor: 'pointer',
                              color: 'inherit',
                            }}
                            hoverStyle={{ background: '#eafaf3' }}
                          >
                            <div style={{ color: '#6b7280' }}>{e.date ?? '—'}</div>
                            <div><strong>{e.ticker}</strong></div>
                            <div style={{ textAlign: 'right' }}>{f.shares}</div>
                            <div style={{ textAlign: 'right', color: (e.trade?.realizedR ?? 0) >= 0 ? '#06865a' : '#e23d3d' }}>
                              {e.trade ? `${e.trade.realizedR >= 0 ? '+' : ''}${nf(e.trade.realizedR, 2)}R` : '—'}
                            </div>
                            <div style={{ textAlign: 'right', color: f.pnl >= 0 ? '#06865a' : '#e23d3d' }}>{usd2(f.pnl)}</div>
                            <div style={{ textAlign: 'right', color: '#8b9298', fontSize: 11 }}>{e.trade ? reason(e.trade.exitReason) : '—'}</div>
                            <div style={{ color: '#98a0a8', textAlign: 'right' }}>›</div>
                          </HButton>
                        );
                      })}
                    </div>
                  )}
                  {r.account.candidates === 0 && (
                    <div style={{ fontSize: 12, color: '#8b9298', marginTop: 8 }}>
                      No dated strategy fills in this window — the R-stats above still cover the full history.
                    </div>
                  )}
                </div>
              )}

              <div>
                <div data-help="forward-returns" style={{ ...label, marginBottom: 8 }}>Forward returns from entry (naive, ignore stops)</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, r.forwardHorizons.length)}, 1fr)`, gap: 8 }}>
                  {r.forwardHorizons.map((h) => (
                    <div key={h.h} style={card}>
                      <div style={{ fontSize: 11, color: '#98a0a8', fontWeight: 700 }}>{h.h} bars</div>
                      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{pct(h.avg)}</div>
                      <div style={{ fontSize: 11, color: '#8b9298', marginTop: 2 }}>win {nf(h.winRate, 1)}% · n={h.n}</div>
                    </div>
                  ))}
                </div>
              </div>

              {r.factors.some((f) => f.n > 0) && (
                <div>
                  <div data-help="indicators-at-entry" style={{ ...label, marginBottom: 8 }}>MACD / Stoch RSI at entry vs realized R</div>
                  <div style={{ border: '1px solid #eef0f1', borderRadius: 10, overflow: 'hidden', fontSize: 12.5 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 56px 72px 72px', gap: 8, padding: '8px 12px', background: '#f7f8f8', fontWeight: 700, color: '#98a0a8', fontSize: 10.5, textTransform: 'uppercase' }}>
                      <div>Factor</div><div>Bucket</div>
                      <div style={{ textAlign: 'right' }}>n</div>
                      <div style={{ textAlign: 'right' }}>Win</div>
                      <div style={{ textAlign: 'right' }}>Avg R</div>
                    </div>
                    {r.factors.filter((f) => f.n > 0).map((f) => (
                      <div
                        key={`${f.factor}-${f.bucket}`}
                        style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 56px 72px 72px', gap: 8, padding: '7px 12px', borderTop: '1px solid #f4f5f6', fontVariantNumeric: 'tabular-nums' }}
                      >
                        <div style={{ color: '#6b7280' }}>{f.factor}</div>
                        <div>{f.bucket}</div>
                        <div style={{ textAlign: 'right' }}>{f.n}</div>
                        <div style={{ textAlign: 'right' }}>{nf(f.winRate, 0)}%</div>
                        <div style={{ textAlign: 'right', color: f.avgR >= 0 ? '#06865a' : '#e23d3d' }}>
                          {f.avgR >= 0 ? '+' : ''}{nf(f.avgR, 2)}R
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {r.entries.length > 0 && (
                <div>
                  <div style={{ ...label, marginBottom: 8 }}>
                    Recent entries ({entryCount === 0 ? '0' : `${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, entryCount)}`} of {entryCount}
                    {r.totalEntries > entryCount ? `, ${r.totalEntries} in universe` : ''}) — click a row for the trade chart
                  </div>
                  <div style={{ border: '1px solid #eef0f1', borderRadius: 10, overflow: 'hidden', fontSize: 12.5 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 72px 64px 64px 88px 18px', gap: 8, padding: '8px 12px', background: '#f7f8f8', fontWeight: 700, color: '#98a0a8', fontSize: 10.5, textTransform: 'uppercase' }}>
                      <div>Date</div><div>Name</div>
                      <div style={{ textAlign: 'right' }}>Entry</div>
                      <div style={{ textAlign: 'right' }}>R</div>
                      <div style={{ textAlign: 'right' }}>P/L</div>
                      <div style={{ textAlign: 'right' }}>Exit</div>
                      <div />
                    </div>
                    {pageRows.map((e) => (
                      <HButton
                        key={`${e.ticker}-${e.barIndex}`}
                        type="button"
                        title={`${e.ticker} — open trade chart`}
                        onClick={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          const entry = e;
                          queueMicrotask(() => useScreener.getState().inspectFanEntry(entry));
                        }}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '72px 1fr 72px 64px 64px 88px 18px',
                          gap: 8,
                          padding: '8px 12px',
                          border: 'none',
                          borderTop: '1px solid #f4f5f6',
                          borderRadius: 0,
                          width: '100%',
                          boxSizing: 'border-box',
                          background: '#fff',
                          fontFamily: 'inherit',
                          fontSize: 12.5,
                          fontVariantNumeric: 'tabular-nums',
                          textAlign: 'left',
                          cursor: 'pointer',
                          color: 'inherit',
                        }}
                        hoverStyle={{ background: '#eafaf3' }}
                      >
                        <div style={{ color: '#6b7280' }}>{e.date ?? '—'}</div>
                        <div><strong>{e.ticker}</strong></div>
                        <div style={{ textAlign: 'right' }}>{nf(e.entryPrice)}</div>
                        <div style={{ textAlign: 'right', color: (e.trade?.realizedR ?? 0) >= 0 ? '#06865a' : '#e23d3d' }}>
                          {e.trade ? `${e.trade.realizedR >= 0 ? '+' : ''}${nf(e.trade.realizedR, 2)}R` : '—'}
                        </div>
                        <div style={{ textAlign: 'right', color: (e.trade?.returnPct ?? 0) >= 0 ? '#06865a' : '#e23d3d' }}>
                          {e.trade ? pct(e.trade.returnPct) : '—'}
                        </div>
                        <div style={{ textAlign: 'right', color: '#8b9298', fontSize: 11 }}>{e.trade ? reason(e.trade.exitReason) : '—'}</div>
                        <div style={{ color: '#98a0a8', textAlign: 'right' }}>›</div>
                      </HButton>
                    ))}
                  </div>
                  {pageCount > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                      <HButton
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={safePage === 0}
                        style={{ padding: '6px 10px', border: '1px solid #e7e8ea', borderRadius: 7, background: '#fff', fontSize: 12, fontWeight: 600, cursor: safePage === 0 ? 'default' : 'pointer', fontFamily: 'inherit', color: safePage === 0 ? '#c4c8cc' : '#5b6168' }}
                        hoverStyle={safePage === 0 ? undefined : { background: '#f7f8f8' }}
                      >
                        Previous
                      </HButton>
                      <div style={{ fontSize: 12, color: '#8b9298', fontVariantNumeric: 'tabular-nums' }}>
                        Page {safePage + 1} / {pageCount}
                      </div>
                      <HButton
                        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                        disabled={safePage >= pageCount - 1}
                        style={{ padding: '6px 10px', border: '1px solid #e7e8ea', borderRadius: 7, background: '#fff', fontSize: 12, fontWeight: 600, cursor: safePage >= pageCount - 1 ? 'default' : 'pointer', fontFamily: 'inherit', color: safePage >= pageCount - 1 ? '#c4c8cc' : '#5b6168' }}
                        hoverStyle={safePage >= pageCount - 1 ? undefined : { background: '#f7f8f8' }}
                      >
                        Next
                      </HButton>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <Disclosure note="Simulation is naive: stop wins ties with the target on the same bar; trail/breakeven update after the bar; no costs or gaps. Stops sit 0.25 ATR under the swing. The swing account sizes 1R from the initial stop, exits before same-day entries, and does not re-arm a name when a fill is skipped for cash or slots." />
          </div>
          <div style={{
            flex: '1 1 460px', minWidth: 320, maxWidth: 560, minHeight: 0,
            overflowY: 'auto', padding: '18px 20px 18px 18px',
            borderLeft: '1px solid #f0f1f2', background: '#fcfcfd',
          }}>
            <FanExampleChart config={bt.config} />
          </div>
            </>
          )}
        </div>

        <div style={{ padding: '14px 24px 20px', borderTop: '1px solid #f0f1f2', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <HButton
            onClick={close}
            style={{ padding: '9px 16px', border: '1px solid #e7e8ea', borderRadius: 9, background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            hoverStyle={{ background: '#f7f8f8' }}
          >
            Close
          </HButton>
          <HButton
            onClick={() => { setPage(0); void run(); }}
            disabled={bt.running}
            style={{
              padding: '9px 18px', border: 'none', borderRadius: 9, background: bt.running ? '#9ddfc4' : '#06a96b',
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: bt.running ? 'default' : 'pointer', fontFamily: 'inherit',
            }}
            hoverStyle={{ background: '#058f5c' }}
          >
            {bt.running ? 'Running…' : r ? 'Re-run' : 'Run backtest'}
          </HButton>
        </div>
      </div>
    </div>
  );
}
