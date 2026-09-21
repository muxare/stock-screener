// app.ts — the Fastify application (hardening 2.1).
//
// What used to be a chain of `url.startsWith` checks with a hand-written body
// reader and a hand-written error mapper is now a router, a content-type parser
// and an error handler that the framework owns. Four things survived the move
// unchanged, because they are this service's behaviour rather than the router's:
//
//   - `RequestError` is still the 400 signal, and anything that is not one is
//     still a logged 500, so a 500 is never silent;
//   - an empty JSON body still parses as `{}` — `/screen` has always accepted a
//     bodyless POST, and Fastify's stock parser rejects one with a 400;
//   - `/backtest` still streams NDJSON from the raw socket;
//   - the `/dev/*` surface still exists only when DEV_TOOLS is set, now because
//     the plugin is not registered rather than because a condition said no.
//
// `handlers.ts` did not change at all. That seam — parsed request + warm universe
// → plain result — is why swapping the transport was a day's work, and phase E of
// `docs/cca-f-learning-plan.md` wraps the same functions as MCP tools.

import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { RequestError } from './handlers.ts';
import { productionUniverse } from './universe.ts';
import type { UniverseStore } from './universe.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';
import type { Logger } from './logger.ts';
import { systemRoutes } from './routes/system.ts';
import { screenRoutes } from './routes/screen.ts';
import { instrumentRoutes } from './routes/instrument.ts';
import { devRoutes } from './routes/dev.ts';

export interface AppOptions {
  /** The warm universe to serve. Defaults to the process-wide singleton. */
  store?: UniverseStore;
  /** Register the `/dev/*` plugin. Defaults to the validated DEV_TOOLS flag. */
  devTools?: boolean;
  /** `false` silences the app; tests use it, or pass a pino instance to capture. */
  logger?: Logger | false;
}

// Every error leaves by this door, in one shape: `{ "error": "<message>" }`.
//
// A RequestError is the caller's fault and carries a message written for them.
// A framework error — invalid JSON, an unsupported content type, a body over the
// limit, a path Fastify cannot decode — already knows its own status, and below
// 500 its message is safe to repeat. Anything else is ours: it is logged with the
// stack and answered with a flat "internal error", because the one thing worse
// than a 500 is a 500 that says nothing anywhere.
function sendError(err: unknown, request: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof RequestError) {
    void reply.code(400).send({ error: err.message });
    return;
  }
  const status = (err as { statusCode?: number }).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    void reply.code(status).send({ error: (err as Error).message });
    return;
  }
  request.log.error({ err }, 'request failed');
  // `/backtest` hijacks its reply and writes headers itself; if it fails after
  // that there is nothing left to say on the wire, so end the response rather
  // than throwing a second error on top of the first.
  if (reply.raw.headersSent) {
    reply.raw.end();
    return;
  }
  void reply.code(500).send({ error: 'internal error' });
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const store = opts.store ?? productionUniverse;
  const devTools = opts.devTools ?? config.devTools;
  const log = opts.logger === undefined ? logger : opts.logger;

  // Typed as the widened `FastifyServerOptions` on purpose: handing Fastify a
  // concrete pino instance otherwise narrows the whole instance's logger generic,
  // and every route plugin would have to be generic in it to match.
  const serverOptions: FastifyServerOptions = {
    ...(log === false ? { logger: false } : { loggerInstance: log }),
    // Bad URLs and other pre-routing framework failures answer in the same shape
    // as everything else instead of Fastify's default error envelope.
    frameworkErrors: sendError,
  };
  const app = Fastify(serverOptions);

  // The service speaks JSON and nothing else. Dropping Fastify's stock parsers
  // drops its `text/plain` one too, which matters: `text/plain` is one of the
  // three content types a cross-origin form can post without a preflight, and
  // with a parser installed for it such a request would reach a handler. Now all
  // three answer 415 before a body is read, which is the property `requireJson`
  // used to provide for `/dev/*` by hand — and it now covers every route.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = (body as string).trim();
    // A bodyless POST is legal here — `/screen` takes no body at all — so an
    // empty payload is an empty object rather than Fastify's 400.
    if (!raw) { done(null, {}); return; }
    try { done(null, JSON.parse(raw)); }
    catch { done(new RequestError('invalid JSON body'), undefined); }
  });

  app.setErrorHandler(sendError);
  app.setNotFoundHandler((_request, reply) => { void reply.code(404).send({ error: 'not found' }); });

  app.register(systemRoutes, { store });
  app.register(screenRoutes, { store });
  app.register(instrumentRoutes, { store });
  // DEV/TEST ONLY (SAD#8.7). The gate is the registration itself.
  if (devTools) app.register(devRoutes, { store });

  return app;
}
