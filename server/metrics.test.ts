// metrics.test.ts — STORY-021 latency instrumentation unit tests.
//
// Proves the recorder computes the distribution it claims and flags samples that
// breach the SAD#2.3 (screen p95 ≤ 3s) / SAD#2.4 (backtest ≤ 30s) budgets, so a
// budget regression is visible rather than silently averaged away.

import { describe, it, expect } from 'vitest';
import { LatencyMetrics, BUDGET_MS } from './metrics.ts';

describe('LatencyMetrics — latency vs the SAD#2.3/2.4 budgets (STORY-021)', () => {
  it('computes p50/p95/max over recorded samples', () => {
    const m = new LatencyMetrics();
    for (let i = 1; i <= 100; i++) m.record('screen', i, () => {}); // 1..100 ms
    const s = m.stats('screen');
    expect(s.count).toBe(100);
    expect(s.p50).toBe(50);   // nearest-rank
    expect(s.p95).toBe(95);
    expect(s.max).toBe(100);
    expect(s.budgetMs).toBe(BUDGET_MS.screen);
  });

  it('flags + logs a screen sample over the SAD#2.3 budget (regression visible)', () => {
    const m = new LatencyMetrics();
    const warnings: string[] = [];
    m.record('screen', BUDGET_MS.screen + 1, (msg) => warnings.push(msg));
    const s = m.stats('screen');
    expect(s.overBudget).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('screen');
    expect(warnings[0]).toContain('budget');
  });

  it('does not flag samples within budget', () => {
    const m = new LatencyMetrics();
    const warnings: string[] = [];
    m.record('backtest', BUDGET_MS.backtest - 1, (msg) => warnings.push(msg));
    expect(m.stats('backtest').overBudget).toBe(0);
    expect(warnings).toHaveLength(0);
  });

  it('keeps screen and backtest budgets/samples independent', () => {
    const m = new LatencyMetrics();
    m.record('screen', 10, () => {});
    expect(m.stats('backtest').count).toBe(0);      // no cross-contamination
    expect(m.stats('backtest').budgetMs).toBe(30000);
    expect(m.stats('screen').budgetMs).toBe(3000);
  });

  it('reports empty stats without throwing', () => {
    const s = new LatencyMetrics().stats('screen');
    expect(s).toMatchObject({ count: 0, p50: 0, p95: 0, max: 0 });
  });
});
