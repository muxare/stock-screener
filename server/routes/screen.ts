// routes/screen.ts — the engine surface: universe facts, the fan screen, live
// signals, and the backtest stream.
//
// These four share a shape: validate the body, turn it into something the
// transport-agnostic handlers in `handlers.ts` understand, run it over the warm
// universe, serialise the result. Since hardening 2.2 the first and last steps
// are declared rather than written: each route names its request and response
// schemas (`server/schemas/screen.ts`), Fastify validates the body against the
// one before the handler runs and serialises the result against the other. The
// handler is left with the meaning — `signalsConfigFromBody` and
// `backtestConfigFromBody`, which still defer to `src/lib/strategy/parse.ts`.
//
// A POST with no body at all is a legal request here — `/screen` ignores its
// body entirely, and the other two report a missing strategy in their own words
// — and `app.ts` turns it into `{}` before validation, which is why nothing
// below reads `request.body ?? {}` any more.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { handleScreen, handleFacets, handleSignals } from '../handlers.ts';
import { signalsConfigFromBody } from '../signals.ts';
import { backtestConfigFromBody, runFanBacktest } from '../fanBacktest.ts';
import { metrics } from '../metrics.ts';
import { errorResponses } from '../schemas/common.ts';
import {
  FactsResponseSchema,
  ScreenResponseSchema,
  SignalsRequestSchema,
  SignalsResponseSchema,
  BacktestRequestSchema,
  BacktestStreamLineSchema,
} from '../schemas/screen.ts';
import type { BacktestProgressLine } from '../schemas/screen.ts';
import type { RouteDeps } from './deps.ts';

export const screenRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, deps) => {
  // Universe count + sector facets only (STORY-028): bootstrap reads these to
  // show the "of N" total and the sector filter list without pulling the full
  // per-name row payload a `/screen` would serialise.
  app.get('/facts', {
    schema: { summary: 'Universe size and sector facets', response: { 200: FactsResponseSchema } },
  }, async () => handleFacets(deps.store.get()));

  app.post('/screen', {
    schema: {
      summary: 'The EMA-fan screen over the whole universe',
      description: 'Takes no body; any JSON body is ignored.',
      response: { 200: ScreenResponseSchema, ...errorResponses },
    },
  }, async (request) => {
    const result = handleScreen(deps.store.get());
    metrics.record('screen', result.elapsedMs, (m) => request.log.warn(m));
    return result;
  });

  // Live "current entry" screen (per strategy): names with an open fan-strategy
  // trade on the latest bar, with entry / stop / R / target-window numbers.
  app.post('/signals', {
    schema: {
      summary: 'Names with an open entry for one strategy on the latest bar',
      body: SignalsRequestSchema,
      response: { 200: SignalsResponseSchema, ...errorResponses },
    },
  }, async (request) => {
    const config = signalsConfigFromBody(request.body);
    return handleSignals(deps.store.get(), config);
  });

  // NDJSON stream: one progress line per name scanned, then exactly one result
  // line. The reply is hijacked so the raw socket can be written to as the
  // synchronous backtest runs — Fastify's own serialiser would hold the whole
  // run and emit it at the end, which is the opposite of what a progress stream
  // is for. Hijacking means Fastify will not log the response, so this route
  // logs its own completion.
  //
  // Validation and parsing happen BEFORE the hijack, so a malformed body or a
  // bad strategy is still an ordinary 400 through the error handler. Once the
  // headers are out that is no longer possible: an engine failure mid-run can
  // only end the stream without a result line, and the client reports "stream
  // ended without result".
  //
  // The 200 response is declared for the OpenAPI document only. Fastify never
  // serialises it — the reply is hijacked — so the per-line schema documents
  // the stream rather than enforcing it; see `schemas/screen.ts`.
  app.post('/backtest', {
    schema: {
      summary: 'Backtest one strategy over the universe, streamed as NDJSON',
      description: 'One `progress` line per name scanned, then exactly one `result` line.',
      body: BacktestRequestSchema,
      response: {
        200: {
          description: 'An NDJSON stream; each line is one of the shapes below.',
          content: { 'application/x-ndjson': { schema: BacktestStreamLineSchema } },
        },
        ...errorResponses,
      },
    },
  }, async (request, reply) => {
    const config = backtestConfigFromBody(request.body);
    const universe = deps.store.get();
    const start = performance.now();
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    try {
      const result = runFanBacktest(universe, config, (p) => {
        const line: BacktestProgressLine = { type: 'progress', ...p };
        raw.write(JSON.stringify(line) + '\n');
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
