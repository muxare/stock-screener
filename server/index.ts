// index.ts — Node screening service (SAD#4.2 / SAD#8.3 / ADR-003).
//
// Hosts the SAME `src/lib/market.ts` engine server-side (no fork) and exposes a
// small HTTP/JSON API so full-universe screens leave the browser (SAD#2.5).
// Stateless w.r.t. user identity. Run with:  node server/index.ts
//
// Endpoints:
//   GET  /health  -> { ok, universe }   liveness + warm-universe size
//   POST /screen  -> ScreenResponse      body: ScreenRequest (see handlers.ts)

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { productionUniverse } from './universe.ts';
import type { UniverseStore } from './universe.ts';
import { handleScreen, RequestError } from './handlers.ts';
import type { ScreenRequest } from './handlers.ts';

const MAX_BODY_BYTES = 1 << 20; // 1 MiB — rule sets are small

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RequestError('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new RequestError('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

export function createScreenServer(store: UniverseStore = productionUniverse) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/health') {
      sendJson(res, 200, { ok: true, universe: store.get().length });
      return;
    }

    if (req.method === 'POST' && url === '/screen') {
      readJsonBody(req)
        .then((body) => {
          const result = handleScreen(store.get(), body as ScreenRequest);
          sendJson(res, 200, result);
        })
        .catch((err: unknown) => {
          if (err instanceof RequestError) sendJson(res, 400, { error: err.message });
          else sendJson(res, 500, { error: 'internal error' });
        });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

// Run as a script: warm the universe at boot so the first screen is already on
// the warm-cache path (SAD#2.3), then listen.
if (import.meta.main) {
  const port = Number(process.env.PORT) || 8787;
  productionUniverse.get();
  createScreenServer().listen(port, () => {
    console.log(`screening service listening on http://localhost:${port}`);
  });
}
