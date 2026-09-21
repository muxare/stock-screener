// testHarness.ts — shared plumbing for the tests that drive the app over a real
// socket. Not part of the service; nothing under `routes/` or `app.ts` imports it.
//
// Most of the routing coverage added in hardening 2.3 uses `app.inject()`, which
// runs the whole Fastify lifecycle without a network. A few cases cannot: the
// NDJSON stream has to be read incrementally, and the shutdown tests need a real
// keep-alive connection. Those bind an ephemeral port through here.

import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { AppOptions } from './app.ts';
import type { UniverseStore } from './universe.ts';

export interface RunningApp {
  app: FastifyInstance;
  /** Origin of the listening app, e.g. `http://127.0.0.1:54321`. */
  base: string;
  close(): Promise<void>;
}

/** Build a silent app over `store` and listen on an ephemeral loopback port. */
export async function startApp(
  store: UniverseStore,
  opts: Omit<AppOptions, 'store'> = {},
): Promise<RunningApp> {
  const app = buildApp({ store, logger: false, ...opts });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, base: `http://127.0.0.1:${port}`, close: () => app.close() };
}
