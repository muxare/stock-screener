// index.ts — Node screening service (SAD#4.2 / SAD#8.3 / ADR-003).
//
// Hosts the SAME `src/lib/market.ts` engine server-side (no fork) and exposes a
// small HTTP/JSON API so full-universe screens leave the browser (SAD#2.5).
// Stateless w.r.t. user identity. Run with:  node server/index.ts
//
// Endpoints:
//   GET  /health            -> { ok, universe }  liveness + warm-universe size
//   GET  /facts             -> FactsResponse      universe count + sector facets
//                                                  (no per-name rows; STORY-028)
//   GET  /metrics           -> latency snapshot    per-path p50/p95/max vs the
//                                                  SAD#2.3/2.4 budgets (STORY-021)
//   GET  /instrument/:ticker -> InstrumentBars   one name's bars (404 unknown)
//   POST /screen            -> ScreenResponse     EMA-fan matches + near list
//   POST /signals           -> SignalsResponse    live per-strategy open entries
//   POST /backtest          -> NDJSON stream      fan-entry backtest (progress + result)

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { productionUniverse } from './universe.ts';
import type { UniverseStore } from './universe.ts';
import { handleScreen, handleFacets, handleSignals, RequestError } from './handlers.ts';
import { parseFanSignalsBody } from './signals.ts';
import { metrics } from './metrics.ts';
import { parseFanBacktestBody, runFanBacktest } from './fanBacktest.ts';
import { devToolsEnabled, listImportOptions, runDevImport } from './devImport.ts';
import type { DevImportRequest } from './devImport.ts';
import { listDatabases, activateDatabase } from './devDataset.ts';
import type { ActivateRequest } from './devDataset.ts';

const MAX_BODY_BYTES = 1 << 20; // 1 MiB
const MAX_IMPORT_BODY_BYTES = 64 << 20; // 64 MiB — CSV uploads (DEV_TOOLS)

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

// Uniform error mapping for every route: a RequestError is the caller's fault
// (400); anything else is ours (500) and is logged, so a 500 is never silent.
function sendError(res: ServerResponse, err: unknown, path: string): void {
  if (err instanceof RequestError) { sendJson(res, 400, { error: err.message }); return; }
  console.error(`[server] ${path} failed:`, err);
  if (res.headersSent) { res.end(); return; }
  sendJson(res, 500, { error: 'internal error' });
}

// State-changing dev routes accept JSON only. A cross-origin form or text/plain
// POST from a page the developer happens to have open is rejected before its body
// is read, which is what keeps /dev/import from being a CSRF target.
function requireJson(req: IncomingMessage): void {
  const ct = String(req.headers['content-type'] ?? '');
  if (!ct.toLowerCase().startsWith('application/json')) {
    throw new RequestError('expected content-type: application/json');
  }
}

function readJsonBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
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
  // DEV/TEST ONLY (SAD#8.7): the EOD-import surface exists only when DEV_TOOLS is
  // set. Resolved once at server creation — the flag does not change at runtime.
  const devOn = devToolsEnabled();

  const route = (req: IncomingMessage, res: ServerResponse, url: string): void => {

    // Dev-only data tooling (STORY-031 import + STORY-035 DB-selector). Gated:
    // when DEV_TOOLS is off these paths simply fall through to the 404 below, so
    // the feature cannot exist in a production deployment.
    if (devOn && url.startsWith('/dev/')) {
      // EOD CSV import from the UI (STORY-031): build a SQLite DB and switch onto it.
      if (req.method === 'GET' && url === '/dev/import/options') {
        sendJson(res, 200, listImportOptions());
        return;
      }
      if (req.method === 'POST' && url === '/dev/import') {
        requireJson(req);
        readJsonBody(req, MAX_IMPORT_BODY_BYTES)
          .then((body) => sendJson(res, 200, runDevImport(body as DevImportRequest, store)))
          .catch((err: unknown) => sendError(res, err, url));
        return;
      }

      // DB-selector (STORY-035): list already-built DBs and switch the active one
      // at runtime (no import, no restart) — a provider swap behind the port.
      if (req.method === 'GET' && url === '/dev/databases') {
        sendJson(res, 200, listDatabases(store));
        return;
      }
      if (req.method === 'POST' && url === '/dev/databases/activate') {
        requireJson(req);
        readJsonBody(req)
          .then((body) => sendJson(res, 200, activateDatabase(body as ActivateRequest, store)))
          .catch((err: unknown) => sendError(res, err, url));
        return;
      }
    }

    if (req.method === 'GET' && url === '/health') {
      sendJson(res, 200, { ok: true, universe: store.get().length });
      return;
    }

    // Universe count + sector facets only (STORY-028): bootstrap reads these to
    // show the "of N" total and the sector filter list without pulling the full
    // per-name row payload a `/screen` would serialise.
    if (req.method === 'GET' && url === '/facts') {
      sendJson(res, 200, handleFacets(store.get()));
      return;
    }

    // Latency snapshot (STORY-021): per-path p50/p95/max and over-budget counts
    // measured against the SAD#2.3/2.4 budgets, for observability/assertions.
    if (req.method === 'GET' && url === '/metrics') {
      sendJson(res, 200, metrics.snapshot());
      return;
    }

    // One instrument's adjusted bars + metadata (SAD#4.3): the client builds the
    // Stock locally for the names it displays (SAD#4.1 / SAD#2.5). No
    // full-universe build is triggered to serve a single name.
    if (req.method === 'GET' && url.startsWith('/instrument/')) {
      let ticker: string;
      try { ticker = decodeURIComponent(url.slice('/instrument/'.length).split('?')[0]); }
      catch { sendJson(res, 400, { error: 'malformed ticker' }); return; }
      const bars = store.getInstrument(ticker);
      if (!bars) sendJson(res, 404, { error: 'unknown ticker' });
      else sendJson(res, 200, bars);
      return;
    }

    if (req.method === 'POST' && url === '/screen') {
      readJsonBody(req)
        .then(() => {
          const result = handleScreen(store.get());
          metrics.record('screen', result.elapsedMs);
          sendJson(res, 200, result);
        })
        .catch((err: unknown) => sendError(res, err, url));
      return;
    }

    // Live "current entry" screen (per strategy): names with an open fan-strategy
    // trade on the latest bar, with entry / stop / R / target-window numbers.
    if (req.method === 'POST' && url === '/signals') {
      readJsonBody(req)
        .then((body) => {
          const config = parseFanSignalsBody(body);
          const result = handleSignals(store.get(), config);
          sendJson(res, 200, result);
        })
        .catch((err: unknown) => sendError(res, err, url));
      return;
    }

    if (req.method === 'POST' && url === '/backtest') {
      readJsonBody(req)
        .then((body) => {
          const config = parseFanBacktestBody(body);
          const universe = store.get();
          const start = performance.now();
          res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
          try {
            const result = runFanBacktest(universe, config, (p) => {
              res.write(JSON.stringify({ type: 'progress', ...p }) + '\n');
            });
            const elapsedMs = performance.now() - start;
            metrics.record('backtest', elapsedMs);
            res.write(JSON.stringify({ type: 'result', elapsedMs, ...result }) + '\n');
            res.end();
          } catch (err) {
            // Headers are already out: log and end the stream without a result
            // line; the client reports "stream ended without result".
            console.error('[server] /backtest failed mid-stream:', err);
            res.end();
          }
        })
        .catch((err: unknown) => sendError(res, err, url));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  };

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    try {
      route(req, res, url);
    } catch (err) {
      // A synchronous throw in a GET branch (a provider read failing, a bad
      // request line) must not take the process down.
      sendError(res, err, url);
    }
  });
}

// Run as a script: warm the universe at boot so the first screen is already on
// the warm-cache path (SAD#2.3), then listen.
if (import.meta.main) {
  const port = Number(process.env.PORT) || 8787;
  // Loopback by default: the dev-tools surface must not be reachable from the
  // LAN. Set HOST=0.0.0.0 explicitly to expose it.
  const host = process.env.HOST || '127.0.0.1';
  productionUniverse.get();
  createScreenServer().listen(port, host, () => {
    console.log(`screening service listening on http://${host}:${port}`);
  });
}
