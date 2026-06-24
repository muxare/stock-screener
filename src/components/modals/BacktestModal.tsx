import { useMemo } from 'react';
import type { Rule } from '../../lib/market';
import { useScreener } from '../../store';
import { HButton } from '../ui/Hoverable';

// ----------------------------------------------------------------------------
// Faithful port of the POC backtest modal (Stock Screener.dc.html 681–725).
// Rule-label chips mirror `btRuleLabels` (1920: effective preset rules + custom
// non-rank rules); horizon cards mirror `btCards` (1925–1932).
// ----------------------------------------------------------------------------

export function BacktestModal() {
  const backtestOpen = useScreener((s) => s.backtestOpen);
  const backtestResult = useScreener((s) => s.backtestResult);
  const backtestError = useScreener((s) => s.backtestError);
  const backtestRunning = useScreener((s) => s.backtestRunning);
  const backtestProgress = useScreener((s) => s.backtestProgress);
  const universeSize = useScreener((s) => s.universeSize);
  const activePreset = useScreener((s) => s.activePreset);
  const customRules = useScreener((s) => s.customRules);
  const closeBacktest = useScreener((s) => s.closeBacktest);
  const ruleLabel = useScreener((s) => s.ruleLabel);

  // effective preset + custom non-rank rules → labels
  const btRuleLabels = useMemo(() => {
    const st = useScreener.getState();
    const preset = st.presetById(activePreset);
    const eff: Rule[] = [...preset.rules, ...customRules.filter((r) => (r as { kind: string }).kind !== 'rank')];
    return eff.map((r) => ruleLabel(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreset, customRules]);

  if (!backtestOpen) return null;

  const R = backtestResult;
  const btSignals = R ? R.signals : 0;
  const btFire = R ? R.fireRate.toFixed(1) + '%' : '';
  // "Empty" is a genuine zero-signal RESULT — never the absence of one. A failed
  // run (R null, backtestError set) must not read as "never fired".
  const btEmpty = R ? R.signals === 0 : false;
  const btNoRules = btRuleLabels.length === 0;
  const btCards = R
    ? R.horizons.map((hh) => ({
        h: '+' + hh.h + 'd', n: hh.n,
        winRate: hh.winRate.toFixed(0) + '%', winW: hh.winRate.toFixed(0) + '%',
        avg: (hh.avg >= 0 ? '+' : '') + hh.avg.toFixed(2) + '%', avgColor: hh.avg >= 0 ? '#06a96b' : '#e23d3d',
        median: (hh.median >= 0 ? '+' : '') + hh.median.toFixed(2) + '%',
        best: '+' + hh.best.toFixed(1) + '%', worst: hh.worst.toFixed(1) + '%',
        winColor: hh.winRate >= 50 ? '#06a96b' : '#e23d3d', winBg: hh.winRate >= 50 ? '#eafaf3' : '#fdeceb',
      }))
    : [];

  return (
    <div onClick={closeBacktest} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.3)', animation: 'popin 0.18s ease' }}>
        <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid #f0f1f2' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Backtest · active screen</div>
          <div style={{ fontSize: 12.5, color: '#8b9298', marginTop: 3 }}>Every bar of all {universeSize} names, ~1y history — forward return from buying the close on each signal.</div>
        </div>
        <div style={{ padding: '18px 24px' }}>
          {backtestRunning && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, color: '#8b9298', marginBottom: 7 }}>Running server-side backtest… {backtestProgress}%</div>
              <div style={{ height: 5, background: '#eceef0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: backtestProgress + '%', background: '#06a96b', transition: 'width 0.15s ease' }} />
              </div>
            </div>
          )}
          {btNoRules && (
            <div style={{ fontSize: 13, color: '#8b9298', lineHeight: 1.5, marginBottom: 14 }}>No filters active — this is the unconditional baseline (every bar fires).</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {btRuleLabels.map((bl, i) => (
              <span key={i} style={{ fontSize: 11.5, fontWeight: 500, padding: '5px 9px', borderRadius: 7, background: '#eafaf3', color: '#06865a', border: '1px solid #bfe8d6' }}>{bl}</span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 24, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signals</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{btSignals}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#98a0a8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fire rate</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{btFire}</div>
            </div>
          </div>
          {backtestError && !backtestRunning && (
            <div style={{ fontSize: 13, color: '#b3261a', lineHeight: 1.5, padding: '11px 13px', background: '#fdeceb', border: '1px solid #f5c6c0', borderRadius: 9 }}>{backtestError} The backtest could not run — this is a service error, not a zero-match result.</div>
          )}
          {btEmpty && !backtestRunning && !backtestError && (
            <div style={{ fontSize: 13, color: '#8b9298', lineHeight: 1.5 }}>This screen never fired across the sample. Loosen a rule and try again.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {btCards.map((bc, i) => (
              <div key={i} style={{ border: '1px solid #ececef', borderRadius: 12, padding: 14, background: bc.winBg }}>
                <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, marginBottom: 8 }}>Forward {bc.h}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: bc.winColor }}>{bc.winRate}</span>
                  <span style={{ fontSize: 11, color: '#9aa1a8' }}>win rate</span>
                </div>
                <div style={{ height: 5, background: '#fff', borderRadius: 3, margin: '8px 0 12px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: bc.winW, background: bc.winColor }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b9298' }}>Avg return</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: bc.avgColor }}>{bc.avg}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b9298' }}>Median</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bc.median}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b9298' }}>Best / worst</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bc.best} / {bc.worst}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b9298' }}>Samples</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bc.n}</span></div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#aab0b6', lineHeight: 1.5, marginTop: 16 }}>Demo data for illustrating the workflow — not investment advice. Ranking filters are excluded from history.</div>
        </div>
        <div style={{ display: 'flex', padding: '14px 24px 20px', borderTop: '1px solid #f0f1f2' }}>
          <HButton onClick={closeBacktest} style={{ marginLeft: 'auto', padding: '11px 22px', border: 'none', borderRadius: 10, background: '#15171a', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }} hoverStyle={{ background: '#000' }}>Done</HButton>
        </div>
      </div>
    </div>
  );
}
