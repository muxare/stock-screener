// routes/system.ts — liveness and instrumentation.
//
// Both are reads of process state rather than of a request, and neither takes a
// body. `/health` reporting the universe size means it builds the universe, so
// it is a liveness probe doing readiness work; hardening phase 4.4 splits the two
// and this file is where that split will land.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { metrics } from '../metrics.ts';
import { HealthResponseSchema, MetricsResponseSchema } from '../schemas/system.ts';
import type { RouteDeps } from './deps.ts';

export const systemRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, deps) => {
  app.get('/health', {
    schema: { summary: 'Liveness, with the universe size', response: { 200: HealthResponseSchema } },
  }, async () => ({ ok: true as const, universe: deps.store.get().length }));

  // Latency snapshot (STORY-021): per-path p50/p95/max and over-budget counts
  // measured against the SAD#2.3/2.4 budgets, for observability/assertions.
  app.get('/metrics', {
    schema: { summary: 'Latency percentiles per path', response: { 200: MetricsResponseSchema } },
  }, async () => metrics.snapshot());
};
