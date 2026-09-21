// logger.ts — the service's root pino logger (hardening 2.3).
//
// One instance for the process. `app.ts` hands it to Fastify, which derives a
// child logger per request carrying that request's id, so every line a handler
// writes can be tied back to the request that caused it — which is the whole
// point of replacing `console.error` with this. Modules that log outside a
// request (boot, shutdown, the latency recorder's budget warnings) use the root
// logger directly.
//
// Nothing here serialises a request or response body. That is deliberate and
// becomes load-bearing at stage 3, where a request body is a screenshot of a
// brokerage account: pino will happily serialise whatever it is handed.

import { pino } from 'pino';
import { config } from './config.ts';

// JSON on one line per event is the right output for a container and the wrong
// one for a person watching `npm run dev`, so development — and only development
// — renders through `pino-pretty`: level as a word, a clock time instead of epoch
// milliseconds, and `pid`/`hostname` dropped, since neither tells you anything
// when the process is the terminal you are looking at.
//
// The gate is `nodeEnv === 'development'` rather than `!== 'production'`, which
// is a narrower claim and buys two things. `pino-pretty` is a devDependency and
// simply is not installed in a production image, so the target must never be
// resolved there; and Vitest sets `NODE_ENV=test`, so the test run does not spawn
// a transport worker per imported module either.
const prettyInDevelopment = config.nodeEnv === 'development'
  ? {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,req.host,req.remoteAddress,req.remotePort', singleLine: true },
      },
    }
  : {};

export const logger = pino({ level: config.logLevel, ...prettyInDevelopment });

export type Logger = typeof logger;
