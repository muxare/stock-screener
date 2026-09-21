// routes/screen.ts — the engine surface: universe facts, the fan screen, live
// signals, and the backtest stream.
//
// These four share a shape: parse the body into something the transport-agnostic
// handlers in `handlers.ts` understand, run it over the warm universe, serialise
// the result. Body parsing stays hand-written (`parseFanSignalsBody`,
// `parseFanBacktestBody` and `src/lib/strategy/parse.ts`); hardening phase 2.2
// replaces the *shape* half of that with schemas, while those parsers keep
// validating *meaning*.
//
// `request.body` is `?? {}` throughout because a POST with no body at all is a
// legal request here: `/screen` ignores its body entirely, and the other two
// report a missing strategy as a 400 from their own parser rather than as a
// TypeError from ours.

import type { FastifyPluginAsync } from 'fastify';
import { handleScreen, handleFacets, handleSignals } from '../handlers.ts';
import { parseFanSignalsBody } from '../signals.ts';
import { parseFanBacktestBody, runFanBacktest } from '../fanBacktest.ts';
import { metrics } from '../metrics.ts';
import type { RouteDeps } from './deps.ts';

export const screenRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  // Universe count + sector facets only (STORY-028): bootstrap reads these to
  // show the "of N" total and the sector filter list without pulling the full
  // per-name row payload a `/screen` would serialise.
  app.get('/facts', async () => handleFacets(deps.store.get()));

  app.post('/screen', async (request) => {
    const result = handleScreen(deps.store.get());
    metrics.record('screen', result.elapsedMs, (m) => request.log.warn(m));
    return result;
  });

  // Live "current entry" screen (per strategy): names with an open fan-strategy
  // trade on the latest bar, with entry / stop / R / target-window numbers.
  app.post('/signals', async (request) => {
    const config = parseFanSignalsBody(request.body ?? {});
    return handleSignals(deps.store.get(), config);
  });

  // NDJSON stream: one progress line per name scanned, then exactly one result
  // line. The reply is hijacked so the raw socket can be written to as the
  // synchronous backtest runs — Fastify's own serialiser would hold the whole
  // run and emit it at the end, which is the opposite of what a progress stream
  // is for. Hijacking means Fastify will not log the response, so this route
  // logs its own completion.
  //
  // Parsing happens BEFORE the hijack, so a bad strategy is still an ordinary
  // 400 through the error handler. Once the headers are out that is no longer
  // possible: an engine failure mid-run can only end the stream without a result
  // line, and the client reports "stream ended without result".
  app.post('/backtest', async (request, reply) => {
    const config = parseFanBacktestBody(request.body ?? {});
    const universe = deps.store.get();
    const start = performance.now();
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    try {
      const result = runFanBacktest(universe, config, (p) => {
        raw.write(JSON.stringify({ type: 'progress', ...p }) + '\n');
      });
      const elapsedMs = performance.now() - start;
      metrics.record('backtest', elapsedMs, (m) => request.log.warn(m));
      raw.write(JSON.stringify({ type: 'result', elapsedMs, ...result }) + '\n');
      raw.end();
      request.log.info(
        { elapsedMs, universe: result.universe, entries: result.totalEntries },
        'backtest stream complete',
      );
    } catch (err) {
      request.log.error({ err }, 'backtest failed mid-stream');
      raw.end();
    }
  });
};
