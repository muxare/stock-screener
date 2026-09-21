// routes/instrument.ts — one instrument's bars.
//
// The client builds the Stock locally for the names it displays (SAD#4.1 /
// SAD#2.5), so serving a single name must not trigger a full-universe build —
// `UniverseStore.getInstrument` goes straight to the provider port (SAD#5.10).
//
// A malformed percent-encoding in the ticker is a 400 rather than a 404, and it
// is Fastify's router that decides that now: find-my-way refuses to decode the
// path and raises FST_ERR_BAD_URL, which `app.ts` maps through the same error
// shape as everything else. The hand-rolled router used to try `decodeURIComponent`
// itself and answer 400 from the handler; the status is the same and the check
// now happens before any handler runs.

import type { FastifyPluginAsync } from 'fastify';
import type { RouteDeps } from './deps.ts';

interface TickerParams { ticker: string }

export const instrumentRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  app.get<{ Params: TickerParams }>('/instrument/:ticker', async (request, reply) => {
    const bars = deps.store.getInstrument(request.params.ticker);
    if (!bars) return reply.code(404).send({ error: 'unknown ticker' });
    return bars;
  });
};
