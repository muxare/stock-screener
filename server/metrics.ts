// metrics.ts — latency instrumentation for the screening-service paths (STORY-021).
//
// The handlers already measure server-side eval time (`elapsedMs`); this records
// those samples per path and checks them against the SAD budgets:
//   - screen   p95 ≤ 3 s   (SAD#2.3, warm-cache full-universe screen)
//   - backtest      ≤ 30 s (SAD#2.4, full universe, server-side)
// A sample over its budget is logged the moment it happens, so a regression is
// visible in the service logs; the accumulated distribution (p50/p95/max + the
// over-budget count) is exposed via `snapshot()` for the `/metrics` endpoint and
// for budget assertions in tests. Instrumentation only — it does not touch the
// engine or the service compute (STORY-016/017 out of scope).

import { logger } from './logger.ts';

export type MetricPath = 'screen' | 'backtest';

// SAD#2.3 / SAD#2.4 v1 latency targets, in milliseconds.
export const BUDGET_MS: Record<MetricPath, number> = {
  screen: 3000,    // p95 ≤ 3 s (SAD#2.3)
  backtest: 30000, // ≤ 30 s (SAD#2.4)
};

export interface PathStats {
  path: MetricPath;
  count: number;
  p50: number;
  p95: number;
  max: number;
  budgetMs: number;
  overBudget: number; // how many samples exceeded the budget
}

// Nearest-rank percentile over an ascending-sorted sample array.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export class LatencyMetrics {
  private samples: Record<MetricPath, number[]> = { screen: [], backtest: [] };
  private over: Record<MetricPath, number> = { screen: 0, backtest: 0 };

  // Record one server-side latency sample. A sample over its SAD budget is logged
  // immediately (regression visible) and counted. `warn` is injectable: the routes
  // pass their request logger, so a breach carries the request id of the request
  // that caused it; the default is the root logger, for callers outside a request.
  record(path: MetricPath, ms: number, warn: (msg: string) => void = (m) => logger.warn(m)): void {
    this.samples[path].push(ms);
    if (ms > BUDGET_MS[path]) {
      this.over[path]++;
      warn(`[latency] ${path} ${ms.toFixed(0)}ms exceeded SAD budget ${BUDGET_MS[path]}ms`);
    }
  }

  stats(path: MetricPath): PathStats {
    const sorted = [...this.samples[path]].sort((a, b) => a - b);
    return {
      path,
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      budgetMs: BUDGET_MS[path],
      overBudget: this.over[path],
    };
  }

  snapshot(): Record<MetricPath, PathStats> {
    return { screen: this.stats('screen'), backtest: this.stats('backtest') };
  }
}

// Process-wide recorder for the running service (one universe per process).
export const metrics = new LatencyMetrics();
