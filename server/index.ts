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
//   GET  /instrument/:ticker -> InstrumentBars   one name's bars (404 unknown)
//   POST /screen            -> ScreenResponse     body: ScreenRequest (handlers.ts)
//   POST /backtest          -> NDJSON stream      body: BacktestRequest; progress
//                                                  lines then one result (SAD#2.4)

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { productionUniverse } from './universe.ts';
import type { UniverseStore } from './universe.ts';
import { handleScreen, handleBacktest, handleFacets, RequestError } from './handlers.ts';
import type { ScreenRequest, BacktestRequest } from './handlers.ts';
import type { Stock } from '../src/lib/market.ts';

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

// Stream a full-universe backtest as NDJSON (SAD#2.4): one `progress` line per
// throttled step while the engine runs, then exactly one `result` line carrying
// the single summary payload (SAD#6.5). Progress is reported so a long backtest
// is observable; the heavy compute runs server-side, off the browser UI thread
// (SAD#2.5). A bad request before any line is written still yields a 400.
function runBacktestStream(res: ServerResponse, universe: Stock[], req: BacktestRequest): void {
  // Emit at most ~20 progress lines regardless of universe size.
  const step = Math.max(1, Math.floor(universe.length / 20));
  let headersSent = false;
  const ensureHeaders = () => {
    if (headersSent) return;
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    headersSent = true;
  };
  const writeLine = (obj: unknown) => { ensureHeaders(); res.write(JSON.stringify(obj) + '\n'); };

  try {
    const summary = handleBacktest(universe, req, ({ name, total }) => {
      if (name === total || name % step === 0) {
        writeLine({ type: 'progress', name, total, pct: Math.round((name / total) * 100) });
      }
    });
    writeLine({ type: 'result', ...summary });
    res.end();
  } catch (err) {
    // If compute hasn't written anything yet we can still send a clean status.
    if (!headersSent) {
      if (err instanceof RequestError) sendJson(res, 400, { error: err.message });
      else sendJson(res, 500, { error: 'internal error' });
    } else {
      writeLine({ type: 'error', error: err instanceof RequestError ? err.message : 'internal error' });
      res.end();
    }
  }
}

export function createScreenServer(store: UniverseStore = productionUniverse) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

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

    // One instrument's adjusted bars + metadata (SAD#4.3): the client builds the
    // Stock locally for the names it displays (SAD#4.1 / SAD#2.5). No
    // full-universe build is triggered to serve a single name.
    if (req.method === 'GET' && url.startsWith('/instrument/')) {
      const ticker = decodeURIComponent(url.slice('/instrument/'.length).split('?')[0]);
      const bars = store.getInstrument(ticker);
      if (!bars) sendJson(res, 404, { error: 'unknown ticker' });
      else sendJson(res, 200, bars);
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

    if (req.method === 'POST' && url === '/backtest') {
      readJsonBody(req)
        .then((body) => runBacktestStream(res, store.get(), body as BacktestRequest))
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
