// index.ts — the screening service's entry point (SAD#4.2 / SAD#8.3 / ADR-003).
//
// Hosts the SAME `src/lib/market.ts` engine server-side (no fork) so full-universe
// screens leave the browser (SAD#2.5). Stateless w.r.t. user identity. Run with:
//   node server/index.ts
//
// Everything this file used to contain now lives next to the thing it belongs to:
// the routes in `routes/`, the application in `app.ts`, the shutdown in
// `shutdown.ts`, the environment in `config.ts`. What is left is the script:
// validate the environment (an import of `config.ts` is enough — it throws on a
// bad one), warm the universe so the first screen is already on the warm-cache
// path (SAD#2.3), listen, and arrange to stop cleanly.
//
// `server/README.md` documents the endpoints, the environment and the shutdown.

import { buildApp } from './app.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { productionUniverse } from './universe.ts';
import { installShutdownHandlers } from './shutdown.ts';

if (import.meta.main) {
  const app = buildApp();
  // `config.toJSON()` and not `config`: the object carries ANTHROPIC_API_KEY and
  // this line would otherwise be the first place it leaked.
  logger.info({ config: config.toJSON(), dataset: productionUniverse.source() }, 'screening service starting');
  productionUniverse.get();
  installShutdownHandlers(app, productionUniverse);
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    logger.error({ err }, 'the screening service could not start');
    process.exit(1);
  }
}
