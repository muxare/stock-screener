// ----------------------------------------------------------------------------
// MarketClient — the single client-side read seam (STORY-035, SAD#4.1 / SAD#5.9).
//
// Every client-to-service HTTP call lives here and nowhere else (SAD#4.1: the
// web client talks to the screening service over HTTP/JSON). The Zustand store
// (SAD#5.9) consumes this seam instead of calling `fetch` directly, so the
// store's data flow is unit-testable without a network by injecting a fake
// implementation.
//
// This is PURE TRANSPORT. It moves bytes; it does not orchestrate. Per SAD#2.5
// no engine logic crosses the seam — the client never builds Stocks, evaluates
// rules, or caches bar arrays. It accepts an optional `AbortSignal` and forwards
// it to `fetch`, but never creates one: generation counters and AbortControllers
// are request-sequencing concerns that stay in the store (SAD#5.9).
//
// Naming (per STORY-035): this is a *client* — NOT a "repository" (reserved for
// SAD#5.8 artifact persistence / ADR-006) and NOT a "provider" (SAD#5.10 is the
// server-side market-data port).
// ----------------------------------------------------------------------------

// ---- transport DTOs (hardening 2.2) ----
// Every request and response type below is inferred from the service's Zod
// schemas in `server/schemas/`, the same declarations Fastify validates and
// serialises against and `@fastify/swagger` publishes at `/docs`. A change to a
// response shape on the server is therefore a compile error here, at the call
// site that reads the field, rather than an `undefined` in the browser.
//
// The imports are `import type` and must stay that way: they are erased before
// bundling, so nothing from `server/` — and in particular not `zod` — reaches
// the browser bundle. The schema modules import only `zod` and engine types,
// which is what lets this program type-check them at all; the service-only
// validation helpers sit apart in `server/schemas/validate.ts`.
//
// The backtest result is the exception, and deliberately: the `/backtest`
// stream is written to the socket by hand and never serialised against a
// schema, so its result line keeps the engine's own `FanBacktestResult`, which
// the browser and the service already share.

import type { FanBacktestConfig, FanBacktestProgress, FanBacktestResult } from '../fanBacktest';
import type { StrategyDef } from '../strategy/types';
import type { InstrumentResponse } from '../../../server/schemas/instrument';
import type {
  FactsResponse,
  ScreenResponse,
  SignalsRequest as SignalsRequestWire,
  SignalsResponse,
  BacktestRequest as BacktestRequestWire,
  BacktestProgressLine,
} from '../../../server/schemas/screen';
import type {
  PortfolioStatusResponse,
  ExtractRequest,
  ExtractResponse,
} from '../../../server/schemas/portfolio';
import type {
  ImportOptionsResponse,
  DevImportRequest as DevImportRequestWire,
  DevImportResponse,
  DatabasesResponse,
  ActivateRequest,
  ActivateResponse,
} from '../../../server/schemas/dev';

export type { FanBacktestConfig, FanBacktestProgress, FanBacktestResult };

export type ScreenResp = ScreenResponse;
export type FanRow = ScreenResp['matches'][number];

// Live "current entry" screen (per strategy). The client carries the strategy
// (a preset id, or the full definition of a saved custom strategy) and the
// universe floors the server reuses to build the scan config. The wire accepts
// more than the client sends — a definition without an id, a null floor — so
// the client's own type is the narrower one, and `signals()` below checks at
// compile time that it still fits the schema.
export type SignalsRequest = Omit<SignalsRequestWire, 'strategy'> & { strategy: string | StrategyDef };
export type SignalsResp = SignalsResponse;
export type FanSignalRow = SignalsResp['rows'][number];

/** What `/backtest` accepts: a `FanBacktestConfig` fits it. */
export type BacktestRequest = BacktestRequestWire;

// Universe facts only (STORY-028): count + sector facets with NO per-name row
// payload.
export type FactsResp = FactsResponse;

export type InstrumentBarsResp = InstrumentResponse;

// ---- dev-only EOD import (STORY-031) ----
export type ImportOptionsResp = ImportOptionsResponse;
export type ImportConfigOption = ImportOptionsResp['configs'][number];
export type ImportDataEntry = ImportOptionsResp['dataEntries'][number];
export type DevImportRequest = DevImportRequestWire;
export type DevImportReport = DevImportResponse;

// ---- portfolio screenshot reader (hardening stage 3) ----
// The extraction is the same `ExtractionSchema` the model is held to on the
// server, so the shape Claude answers in and the shape the confirm UI reads
// are one definition. (Before 2.2 this block restated it by hand.)
export type ExtractPortfolioResp = ExtractResponse;
export type PortfolioExtraction = ExtractPortfolioResp['extraction'];
/** A row as Claude read it. Every readable-or-not field may be null. */
export type ExtractedHolding = PortfolioExtraction['holdings'][number];
export type HoldingConfidence = ExtractedHolding['confidence'];
export type PortfolioStatusResp = PortfolioStatusResponse;
/** The image as the browser read it: base64, or a data URL the service unwraps. */
export type ScreenshotUpload = ExtractRequest['image'];

// ---- dev-only DB-selector (STORY-035) ----
// Lists already-built market-data DBs and switches the active one at runtime.
export type DatabasesResp = DatabasesResponse;
export type DatabaseEntry = DatabasesResp['databases'][number];
// Switch to a SQLite DB by path, OR back to the synthetic generator.
export type ActivateDbRequest = ActivateRequest;
export type ActivateDbReport = ActivateResponse;

// The client-side read seam. Exposes exactly today's calls and nothing
// speculative (STORY-035 AC#1).
export interface MarketClient {
  facts(signal?: AbortSignal): Promise<FactsResp>;
  instrument(ticker: string): Promise<InstrumentBarsResp | null>;
  screen(signal?: AbortSignal): Promise<ScreenResp>;
  signals(body: SignalsRequest, signal?: AbortSignal): Promise<SignalsResp>;
  backtest(
    config: BacktestRequest,
    onProgress?: (p: FanBacktestProgress) => void,
    signal?: AbortSignal,
  ): Promise<FanBacktestResult & { elapsedMs: number }>;
  portfolioStatus(): Promise<PortfolioStatusResp | null>;
  extractPortfolio(image: ScreenshotUpload, signal?: AbortSignal): Promise<ExtractPortfolioResp>;
  devImportOptions(): Promise<ImportOptionsResp | null>;
  devImport(body: DevImportRequest): Promise<DevImportReport>;
  databases(): Promise<DatabasesResp | null>;
  activateDatabase(body: ActivateDbRequest): Promise<ActivateDbReport>;
}

// Bounded client-side transport timeout for the on-demand single-name fetch
// (STORY-054). Unlike `screen`/`facts`/`backtest`, `instrument` takes no external
// AbortSignal — the store's ensureDisplayed/retryDisplayed de-dup guard bails
// while a name is 'loading', so a `/instrument` fetch that never settles (the
// service accepts the connection but never responds) would strand the detail /
// compare spinner forever with no way to recover but a full reload. This bounds
// the TRANSPORT wait only — SAD#2.3's ≤ 50 ms single-name budget is a LOCAL
// compute budget, not this network wait — so a hung connection aborts and the
// promise rejects, surfacing through ensureDisplayed as the existing retryable
// 'error' state (a timeout is indistinguishable from any other transport error).
const DEFAULT_INSTRUMENT_TIMEOUT_MS = 10_000;

// Construction options for the HTTP client. `instrumentTimeoutMs` is injectable
// so tests can drive the timeout path without waiting the production ceiling.
export interface MarketClientOptions {
  instrumentTimeoutMs?: number;
}

// ----------------------------------------------------------------------------
// The production HTTP implementation. Same-origin paths; vite proxies them to
// the Node service in dev (vite.config.ts). Behaviour is a 1:1 move of the
// former `api*` helpers from src/store.ts — same endpoints, same error/null
// semantics, same NDJSON parse.
// ----------------------------------------------------------------------------
// One line of the /backtest NDJSON stream. A line that is not valid JSON or not
// a known message shape is skipped rather than aborting the whole run; a stream
// that never yields a result line still fails at the end with a clear error.
type BacktestStreamMsg =
  | BacktestProgressLine
  | ({ type: 'result'; elapsedMs: number } & FanBacktestResult);

function parseBacktestLine(line: string): BacktestStreamMsg | null {
  if (!line.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const m = parsed as { type?: unknown; name?: unknown; total?: unknown };
  if (m.type === 'progress' && typeof m.name === 'number' && typeof m.total === 'number') {
    return { type: 'progress', name: m.name, total: m.total };
  }
  if (m.type === 'result') return parsed as BacktestStreamMsg;
  return null;
}

export function httpMarketClient(opts: MarketClientOptions = {}): MarketClient {
  const instrumentTimeoutMs = opts.instrumentTimeoutMs ?? DEFAULT_INSTRUMENT_TIMEOUT_MS;
  return {
    async facts(signal) {
      const res = await fetch('/facts', { signal });
      if (!res.ok) throw new Error('facts failed: ' + res.status);
      return res.json() as Promise<FactsResp>;
    },

    async instrument(ticker) {
      // AbortSignal.timeout aborts the fetch after the bound; a service that
      // accepts the connection but never responds therefore REJECTS here (with a
      // TimeoutError) rather than hanging, so the caller's error path can run.
      const res = await fetch('/instrument/' + encodeURIComponent(ticker), {
        signal: AbortSignal.timeout(instrumentTimeoutMs),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('instrument failed: ' + res.status);
      return res.json() as Promise<InstrumentBarsResp>;
    },

    async screen(signal) {
      const res = await fetch('/screen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal,
      });
      if (!res.ok) throw new Error('screen failed: ' + res.status);
      return res.json() as Promise<ScreenResp>;
    },

    async signals(body, signal) {
      const wire: SignalsRequestWire = body;
      const res = await fetch('/signals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(wire),
        signal,
      });
      if (!res.ok) throw new Error('signals failed: ' + res.status);
      return res.json() as Promise<SignalsResp>;
    },

    async backtest(config, onProgress, signal) {
      const res = await fetch('/backtest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
        signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 404) {
          throw new Error('Backtest endpoint not found — restart the Vite dev server so /backtest is proxied.');
        }
        throw new Error(data.error || 'backtest failed: ' + res.status);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('backtest failed: no response body');
      const dec = new TextDecoder();
      let buf = '';
      let result: (FanBacktestResult & { elapsedMs: number }) | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const msg = parseBacktestLine(line);
          if (!msg) continue;
          if (msg.type === 'progress') onProgress?.({ name: msg.name, total: msg.total });
          else result = msg;
        }
      }
      const tail = parseBacktestLine(buf);
      if (tail?.type === 'result') result = tail;
      if (!result) throw new Error('backtest failed: stream ended without result');
      return result;
    },

    // Portfolio screenshot reader (hardening stage 3). `status` is the same
    // capability probe the dev tooling uses: a service with no ANTHROPIC_API_KEY
    // reports `available: false` and the UI does not offer the button, which is
    // better than a button that answers 503 when pressed.
    async portfolioStatus() {
      try {
        const res = await fetch('/portfolio/status');
        if (!res.ok) return null;
        return (await res.json()) as PortfolioStatusResp;
      } catch {
        return null; // service down: the feature stays hidden, like /dev/*
      }
    },

    async extractPortfolio(image, signal) {
      const res = await fetch('/portfolio/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image }),
        signal,
      });
      // The service answers a failure with `{ error, errorCategory, isRetryable }`.
      // Only the message is surfaced here; the category is the service's own
      // vocabulary and the store has nothing to branch on it for yet.
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'extraction failed: ' + res.status);
      }
      try {
        return (await res.json()) as ExtractPortfolioResp;
      } catch {
        throw new Error('extraction failed: response body was not valid JSON');
      }
    },

    // Dev-only EOD import (STORY-031). These hit the DEV_TOOLS-gated /dev/import
    // endpoints; when the flag is off the server 404s and the feature stays hidden.
    async devImportOptions() {
      const res = await fetch('/dev/import/options');
      if (!res.ok) return null; // 404 → dev tools off (or service down): hide the UI
      return res.json() as Promise<ImportOptionsResp>;
    },

    async devImport(body) {
      const res = await fetch('/dev/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Error path: swallow a parse failure so the service `error` (or a status
      // fallback) still surfaces — a broken error body must not mask the failure.
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'import failed: ' + res.status);
      }
      // Success path: a 2xx body that won't parse is a real failure, NOT an empty
      // success — throw rather than returning `{}` cast as a blank report.
      try {
        return (await res.json()) as DevImportReport;
      } catch {
        throw new Error('import failed: response body was not valid JSON');
      }
    },

    // Dev-only DB-selector (STORY-035). Same DEV_TOOLS gate as /dev/import: a 404
    // means the flag is off (or the service is down), so the selector stays hidden.
    async databases() {
      const res = await fetch('/dev/databases');
      if (!res.ok) return null;
      return res.json() as Promise<DatabasesResp>;
    },

    async activateDatabase(body) {
      const res = await fetch('/dev/databases/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Same two-path split as devImport (STORY-036): swallow a parse failure only
      // on the error path so the service `error`/status still surfaces; on a 2xx a
      // body that won't parse is a real failure, not an empty success.
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'activate failed: ' + res.status);
      }
      try {
        return (await res.json()) as ActivateDbReport;
      } catch {
        throw new Error('activate failed: response body was not valid JSON');
      }
    },
  };
}
