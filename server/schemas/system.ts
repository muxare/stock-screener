// schemas/system.ts — `/health` and `/metrics`.

import { z } from 'zod';

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  universe: z.number().describe('Names in the warm universe; building it is part of the probe.'),
});

const PathStatsSchema = z.object({
  path: z.enum(['screen', 'backtest']),
  count: z.number(),
  p50: z.number(),
  p95: z.number(),
  max: z.number(),
  budgetMs: z.number(),
  overBudget: z.number().describe('Samples over the SAD#2.3/2.4 budget.'),
});

export const MetricsResponseSchema = z.object({
  screen: PathStatsSchema,
  backtest: PathStatsSchema,
}).describe('Server-side latency per path, in milliseconds, since the process started.');

export type HealthResponse = z.output<typeof HealthResponseSchema>;
export type MetricsResponse = z.output<typeof MetricsResponseSchema>;
