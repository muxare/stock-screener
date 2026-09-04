import { describe, it, expect } from 'vitest';
import {
  screenFanSignals,
  signalScanConfig,
  signalRowFromEntry,
  currentOpenEntry,
  fmtTargetWindow,
  filterSignalRows,
  strategyLabel,
  SIGNAL_TARGET_LO_R,
  SIGNAL_TARGET_HI_R,
  type FanSignalSubject,
  type FanSignalRow,
} from './fanSignals.ts';
import { ema } from './indicators.ts';
import type { FanEntryEvent } from './fanBacktest.ts';

function rampSeries(flatBars: number, rampBars: number, flat = 10, step = 0.45): number[] {
  return [
    ...Array(flatBars).fill(flat),
    ...Array.from({ length: rampBars }, (_, i) => flat + (i + 1) * step),
  ];
}

/** Closes truncated to end 1 bar after the fan first fully stacks, so the onset
 * entry sits on the second-to-last bar with a single (in-band) forward bar —
 * an entry whose trade is still open at the latest bar. */
function openOnsetCloses(): number[] {
  const full = rampSeries(200, 140);
  const e18 = ema(full, 18);
  const e50 = ema(full, 50);
  const e100 = ema(full, 100);
  const e200 = ema(full, 200);
  let onset = -1;
  for (let i = 200; i < full.length; i++) {
    if (e18[i] > e50[i] && e50[i] > e100[i] && e100[i] > e200[i]) { onset = i; break; }
  }
  if (onset < 0) throw new Error('fixture never stacked');
  return full.slice(0, onset + 2);
}

function subject(over: Partial<FanSignalSubject> = {}): FanSignalSubject {
  const closes = over.closes ?? openOnsetCloses();
  return {
    ticker: 'OPN', name: 'Open Co', sector: 'Tech',
    price: closes[closes.length - 1], changePct: 1.2,
    closes, sparkline: closes.slice(-40),
    avgVol20: 500_000, marketCap: 2e9,
    ...over,
  };
}

const onsetCfg = signalScanConfig('onset');

describe('signalScanConfig', () => {
  it('is an un-managed 3R trade carrying the universe filters', () => {
    const cfg = signalScanConfig('tag50', { minAvgVol: 250_000, minMarketCap: 1e9, ema200RisingBars: 63 });
    expect(cfg.strategy).toBe('tag50');
    expect(cfg.targetR).toBe(SIGNAL_TARGET_HI_R);
    expect(cfg.trailEma).toBeNull();
    expect(cfg.trailPivot).toBe(false);
    expect(cfg.targetWindow).toBe(false);
    expect(cfg.breakevenAtR).toBeNull();
    expect(cfg.maxHoldBars).toBeNull();
    expect(cfg.minAvgVol).toBe(250_000);
    expect(cfg.minMarketCap).toBe(1e9);
    expect(cfg.ema200RisingBars).toBe(63);
  });
});

describe('screenFanSignals', () => {
  it('surfaces a name whose onset trade is still open on the last bar', () => {
    const rows = screenFanSignals([subject()], onsetCfg);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.ticker).toBe('OPN');
    expect(r.strategy).toBe('onset');
    expect(r.barsAgo).toBe(1);
    expect(r.stopPrice).toBeLessThan(r.entryPrice);
    expect(r.riskPerShare).toBeCloseTo(r.entryPrice - r.stopPrice, 8);
    expect(r.targetLoPrice).toBeCloseTo(r.entryPrice + SIGNAL_TARGET_LO_R * r.riskPerShare, 8);
    expect(r.targetHiPrice).toBeCloseTo(r.entryPrice + SIGNAL_TARGET_HI_R * r.riskPerShare, 8);
  });

  it('returns nothing once the trend has fully played out (trade resolved)', () => {
    const resolved = rampSeries(200, 140); // onset resolves at 3R long before the end
    expect(screenFanSignals([subject({ closes: resolved })], onsetCfg)).toEqual([]);
  });

  it('applies the volume floor before scanning', () => {
    const cfg = signalScanConfig('onset', { minAvgVol: 1_000_000 });
    const thin = subject({ ticker: 'THIN', avgVol20: 1_000 });
    expect(screenFanSignals([thin], cfg)).toEqual([]);
  });

  it('excludes unknown market caps when a cap floor is set', () => {
    const cfg = signalScanConfig('onset', { minMarketCap: 1e9 });
    const unknown = subject({ ticker: 'UNK', marketCap: null });
    expect(screenFanSignals([unknown], cfg)).toEqual([]);
  });
});

function sampleEvent(over: Partial<FanEntryEvent> = {}): FanEntryEvent {
  return {
    ticker: 'AAA', name: 'Aaa', date: '2026-01-05', barIndex: 48,
    strategy: 'tag50', signal: 'match', entryPrice: 100, worstGap: 0.02,
    forwardReturns: {},
    trade: {
      entryBar: 48, exitBar: 50, entryPrice: 100, exitPrice: 101,
      stopPrice: 96, targetPrice: 112, returnPct: 1, realizedR: 0.25,
      barsHeld: 2, maxFavorablePct: 1.4, maxAdversePct: -0.5, exitReason: 'end_of_data',
    },
    fanBar: 40, reactionBar: 48, impulseBar: 44, indicators: null,
    ...over,
  };
}

describe('signalRowFromEntry', () => {
  it('computes R and the 2.5–3R exit window from entry and stop', () => {
    const s = subject({ ticker: 'AAA', price: 100.5 });
    const row = signalRowFromEntry(s, sampleEvent(), 51)!;
    expect(row.riskPerShare).toBe(4); // 100 − 96
    expect(row.riskPct).toBeCloseTo(4);
    expect(row.barsAgo).toBe(2); // (51 − 1) − 48
    expect(row.targetLoPrice).toBe(100 + 2.5 * 4);
    expect(row.targetHiPrice).toBe(100 + 3 * 4);
    expect(row.openR).toBe(0.25);
  });

  it('rejects an entry whose stop is not below the entry', () => {
    const bad = sampleEvent({ trade: { ...sampleEvent().trade!, stopPrice: 100 } });
    expect(signalRowFromEntry(subject(), bad, 51)).toBeNull();
  });

  it('rejects a signal with no simulated trade', () => {
    expect(signalRowFromEntry(subject(), sampleEvent({ trade: null }), 51)).toBeNull();
  });
});

describe('currentOpenEntry', () => {
  it('picks the last still-open entry and ignores resolved ones', () => {
    const resolved = sampleEvent({ barIndex: 10, trade: { ...sampleEvent().trade!, exitReason: 'target_r' } });
    const open = sampleEvent({ barIndex: 40 });
    expect(currentOpenEntry([resolved, open])).toBe(open);
    expect(currentOpenEntry([resolved])).toBeNull();
    expect(currentOpenEntry([])).toBeNull();
  });
});

describe('fmtTargetWindow', () => {
  it('renders the price band and the R window', () => {
    const row = { targetLoPrice: 148.2, targetHiPrice: 151, targetLoR: 2.5, targetHiR: 3 } as FanSignalRow;
    expect(fmtTargetWindow(row)).toBe('148.20–151.00 (2.5–3R)');
  });
});

describe('filterSignalRows', () => {
  const rows: FanSignalRow[] = [
    { ...({} as FanSignalRow), ticker: 'BIG', name: 'Big', sector: 'Tech', price: 100 },
    { ...({} as FanSignalRow), ticker: 'MID', name: 'Mid', sector: 'Health', price: 8 },
  ];
  it('filters by sector, min price, and search', () => {
    expect(filterSignalRows(rows, '', 'Tech', 0).map((r) => r.ticker)).toEqual(['BIG']);
    expect(filterSignalRows(rows, '', '', 10).map((r) => r.ticker)).toEqual(['BIG']);
    expect(filterSignalRows(rows, 'mid', '', 0).map((r) => r.ticker)).toEqual(['MID']);
  });
});

describe('strategyLabel', () => {
  it('maps a known id to its label', () => {
    expect(strategyLabel('tag50')).toMatch(/50-EMA tag/);
  });
});
