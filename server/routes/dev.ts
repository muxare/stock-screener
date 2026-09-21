// routes/dev.ts — the DEV_TOOLS-gated data tooling (STORY-031 import,
// STORY-035 DB-selector).
//
// DEV/TEST ONLY (SAD#8.7). The gate is structural: `app.ts` registers this plugin
// or it does not, so with the flag off these paths do not exist and fall to the
// 404 with everything else. That used to be an `if (devOn && …)` inside the
// router, which is the same behaviour held together by a condition someone could
// edit; from stage 5, with more than one user, the difference stops being
// tidiness — these routes hot-swap the active dataset for *everyone*.
//
// Cross-origin POSTs cannot reach them either. The app parses `application/json`
// and nothing else, so the three content types a cross-origin form can send
// without a preflight are refused with 415 before a body is read. The old
// `requireJson` check did that by hand and answered 400.

import type { FastifyPluginAsync } from 'fastify';
import { listImportOptions, runDevImport } from '../devImport.ts';
import type { DevImportRequest } from '../devImport.ts';
import { listDatabases, activateDatabase } from '../devDataset.ts';
import type { ActivateRequest } from '../devDataset.ts';
import type { RouteDeps } from './deps.ts';

// CSV uploads arrive inline in the JSON body, so this one route needs far more
// than the 1 MiB the rest of the service allows.
const MAX_IMPORT_BODY_BYTES = 64 << 20; // 64 MiB

export const devRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  // EOD CSV import from the UI (STORY-031): build a SQLite DB and switch onto it.
  app.get('/dev/import/options', async () => listImportOptions());

  app.post('/dev/import', { bodyLimit: MAX_IMPORT_BODY_BYTES }, async (request) =>
    runDevImport((request.body ?? {}) as DevImportRequest, deps.store));

  // DB-selector (STORY-035): list already-built DBs and switch the active one
  // at runtime (no import, no restart) — a provider swap behind the port.
  app.get('/dev/databases', async () => listDatabases(deps.store));

  app.post('/dev/databases/activate', async (request) =>
    activateDatabase((request.body ?? {}) as ActivateRequest, deps.store));
};
