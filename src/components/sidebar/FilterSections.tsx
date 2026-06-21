import { useMemo } from 'react';
import { useScreener } from '../../store';
import * as M from '../../lib/market';
import { HButton } from '../ui/Hoverable';

/**
 * The three collapsible filter-builder boxes shared by the sidebar and the
 * preset builder modal — faithful ports of the POC:
 *   RuleSection    — "Add screening rule"   (Stock Screener.dc.html 192–235)
 *   PatternSection — "Price action pattern" (237–258)
 *   RankSection    — "Cross-sectional rank" (260–289)
 * View-models mirror renderVals (opOptions 1707–1711, patternOptions 1811,
 * rankFieldOptions 2010).
 */

const boxStyle = { marginTop: 14, border: '1px solid #ececef', borderRadius: 11, background: '#fafbfb', overflow: 'hidden' };
const headerStyle = { width: '100%', boxSizing: 'border-box' as const, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 13px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' };
const headerHover = { background: '#f4f5f6' };
const labelStyle = { fontSize: 11.5, fontWeight: 600, color: '#6b7280' };
const arrowStyle = { fontSize: 10, color: '#aab0b6' };
const fieldStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', marginBottom: 8, cursor: 'pointer' };
const addBtnStyle = { marginTop: 10, width: '100%', padding: 9, border: 'none', borderRadius: 8, background: '#15171a', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const addBtnHover = { background: '#000' };

export function RuleSection() {
  const ruleOpen = useScreener((s) => s.ruleOpen);
  const toggleRuleSection = useScreener((s) => s.toggleRuleSection);
  const savedIndicators = useScreener((s) => s.savedIndicators);
  const rule = useScreener((s) => s.rule);
  const onRuleLeft = useScreener((s) => s.onRuleLeft);
  const onRuleOp = useScreener((s) => s.onRuleOp);
  const onRuleRhsType = useScreener((s) => s.onRuleRhsType);
  const onRuleValue = useScreener((s) => s.onRuleValue);
  const onRuleRight = useScreener((s) => s.onRuleRight);
  const onRuleMin = useScreener((s) => s.onRuleMin);
  const onRuleMax = useScreener((s) => s.onRuleMax);
  const addRule = useScreener((s) => s.addRule);

  const opOptions = [
    { value: 'gt', label: 'is above' }, { value: 'lt', label: 'is below' },
    { value: 'cross_up', label: 'crosses above' }, { value: 'cross_down', label: 'crosses below' },
    { value: 'between', label: 'is between' }, { value: 'rising', label: 'is rising' }, { value: 'falling', label: 'is falling' },
  ];
  const needsRhs = rule.op === 'gt' || rule.op === 'lt' || rule.op === 'cross_up' || rule.op === 'cross_down';
  const canBuild = savedIndicators.length > 0;
  const indicators = savedIndicators as { id: string; name: string }[];

  return (
    <div style={boxStyle}>
      <HButton onClick={toggleRuleSection} style={headerStyle} hoverStyle={headerHover}>
        <span style={labelStyle}>Add screening rule</span>
        <span style={arrowStyle}>{ruleOpen ? '▾' : '▸'}</span>
      </HButton>
      {ruleOpen && (
        <div style={{ padding: '0 13px 13px 13px' }}>
          {canBuild ? (
            <>
              <select value={rule.leftId ?? ''} onChange={(e) => onRuleLeft(e.target.value)} style={fieldStyle}>
                {indicators.map((li) => <option key={li.id} value={li.id}>{li.name}</option>)}
              </select>
              <select value={rule.op} onChange={(e) => onRuleOp(e.target.value)} style={fieldStyle}>
                {opOptions.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
              </select>
              {needsRhs && (
                <>
                  <select value={rule.rhsType} onChange={(e) => onRuleRhsType(e.target.value)} style={fieldStyle}>
                    <option value="const">a value</option>
                    <option value="price">Price (close)</option>
                    <option value="ind">another indicator</option>
                  </select>
                  {rule.rhsType === 'const' && (
                    <input type="number" value={rule.value} onChange={(e) => onRuleValue(e.target.value)} placeholder="value" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
                  )}
                  {rule.rhsType === 'ind' && (
                    <select value={rule.rightId ?? ''} onChange={(e) => onRuleRight(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
                      {indicators.map((ri) => <option key={ri.id} value={ri.id}>{ri.name}</option>)}
                    </select>
                  )}
                </>
              )}
              {rule.op === 'between' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="number" value={rule.min} onChange={(e) => onRuleMin(e.target.value)} placeholder="min" style={{ flex: 1, minWidth: 0, padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
                  <input type="number" value={rule.max} onChange={(e) => onRuleMax(e.target.value)} placeholder="max" style={{ flex: 1, minWidth: 0, padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
                </div>
              )}
              <HButton onClick={addRule} style={addBtnStyle} hoverStyle={addBtnHover}>+ Add filter</HButton>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#aab0b6', lineHeight: 1.5 }}>Create an indicator first, then screen the universe on it.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function PatternSection() {
  const patternOpen = useScreener((s) => s.patternOpen);
  const togglePatternSection = useScreener((s) => s.togglePatternSection);
  const patternDraft = useScreener((s) => s.patternDraft);
  const onPatternType = useScreener((s) => s.onPatternType);
  const onPatternN = useScreener((s) => s.onPatternN);
  const addPattern = useScreener((s) => s.addPattern);

  const patternOptions = useMemo(
    () => Object.entries(M.PATTERNS).map(([k, v]) => ({ value: k, label: v.count ? v.label.replace(/^./, (c) => c.toUpperCase()) : v.label })),
    [],
  );
  const meta = (M.PATTERNS as Record<string, M.PatternMeta>)[patternDraft.pat] || ({} as M.PatternMeta);

  return (
    <div style={boxStyle}>
      <HButton onClick={togglePatternSection} style={headerStyle} hoverStyle={headerHover}>
        <span style={labelStyle}>Price action pattern</span>
        <span style={arrowStyle}>{patternOpen ? '▾' : '▸'}</span>
      </HButton>
      {patternOpen && (
        <div style={{ padding: '0 13px 13px 13px' }}>
          <select value={patternDraft.pat} onChange={(e) => onPatternType(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
            {patternOptions.map((po) => <option key={po.value} value={po.value}>{po.label}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: '#8b9298', lineHeight: 1.45, margin: '9px 2px 0' }}>{meta.desc || ''}</div>
          {meta.count && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 12, color: '#6b7280', flex: 1 }}>{meta.countLabel || 'Count'}</span>
              <input type="number" value={patternDraft.n} onChange={(e) => onPatternN(e.target.value)} min={meta.min} max={meta.max} style={{ width: 74, boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', textAlign: 'center' }} />
            </div>
          )}
          <HButton onClick={addPattern} style={addBtnStyle} hoverStyle={addBtnHover}>+ Add filter</HButton>
        </div>
      )}
    </div>
  );
}

export function RankSection() {
  const rankOpen = useScreener((s) => s.rankOpen);
  const toggleRankSection = useScreener((s) => s.toggleRankSection);
  const rankDraft = useScreener((s) => s.rankDraft);
  const onRankField = useScreener((s) => s.onRankField);
  const onRankScope = useScreener((s) => s.onRankScope);
  const onRankDir = useScreener((s) => s.onRankDir);
  const onRankPct = useScreener((s) => s.onRankPct);
  const addRank = useScreener((s) => s.addRank);

  const rankFieldOptions = useMemo(() => Object.entries(M.RANK_FIELDS).map(([k, v]) => ({ value: k, label: v })), []);

  return (
    <div style={boxStyle}>
      <HButton onClick={toggleRankSection} style={headerStyle} hoverStyle={headerHover}>
        <span style={labelStyle}>Cross-sectional rank</span>
        <span style={arrowStyle}>{rankOpen ? '▾' : '▸'}</span>
      </HButton>
      {rankOpen && (
        <div style={{ padding: '0 13px 13px 13px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={rankDraft.dir} onChange={(e) => onRankDir(e.target.value)} style={{ flex: 'none', width: 96, padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
            <div style={{ position: 'relative', flex: 1 }}>
              <input type="number" value={rankDraft.pct} onChange={(e) => onRankPct(e.target.value)} min={1} max={99} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 22px 8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }} />
              <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#aab0b6', fontSize: 12 }}>%</span>
            </div>
          </div>
          <select value={rankDraft.field} onChange={(e) => onRankField(e.target.value)} style={fieldStyle}>
            {rankFieldOptions.map((rf) => <option key={rf.value} value={rf.value}>{rf.label}</option>)}
          </select>
          <select value={rankDraft.scope} onChange={(e) => onRankScope(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 9px', border: '1px solid #e2e4e6', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
            <option value="all">Across whole universe</option>
            <option value="sector">Within each sector</option>
          </select>
          <HButton onClick={addRank} style={addBtnStyle} hoverStyle={addBtnHover}>+ Add filter</HButton>
          <div style={{ fontSize: 11, color: '#aab0b6', lineHeight: 1.45, marginTop: 8 }}>Ranks the live universe — applies to today's bar (excluded from backtests).</div>
        </div>
      )}
    </div>
  );
}
