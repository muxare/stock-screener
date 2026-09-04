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

import type { InstrumentBars } from '../market';
import type { FanRow } from '../fan';
import type { FanBacktestConfig, FanBacktestProgress, FanBacktestResult, FanStrategyId } from '../fanBacktest';
import type { FanSignalRow } from '../fanSignals';

export type { FanRow };
export type { FanBacktestConfig, FanBacktestProgress, FanBacktestResult };
export type { FanSignalRow };

export interface ScreenResp {
  universe: number;
  elapsedMs: number;
  matches: FanRow[];
  near: FanRow[];
}

// Live "current entry" screen (per strategy). The client carries the strategy
// and the universe floors the server reuses to build the scan config.
export interface SignalsRequest {
  strategy: FanStrategyId;
  minAvgVol?: number;
  minMarketCap?: number;
  ema200RisingBars?: number;
}
export interface SignalsResp {
  universe: number;
  elapsedMs: number;
  strategy: FanStrategyId;
  rows: FanSignalRow[];
}

// Universe facts only (STORY-028): count + sector facets with NO per-name row
// payload.
export interface FactsResp {
  total: number;
  sectors: string[];
  sample: string | null;
}

// ---- dev-only EOD import (STORY-031) transport DTOs ----
export interface ImportConfigOption { name: string; json: unknown }
export interface ImportDataEntry { name: string; type: 'file' | 'dir'; path: string }
export interface ImportOptionsResp {
  configs: ImportConfigOption[];
  dataDir: string;
  dataEntries: ImportDataEntry[];
  targetDb: string;
}
export interface DevImportRequest {
  configName: string;
  configJson?: unknown;
  inputPath?: string;
  uploads?: { name: string; content: string }[];
  targetDb?: string;
}
export interface DevImportReport {
  files: number;
  instruments: number;
  bars: number;
  skipped: number;
  errors: { file: string; line: number; reason: string; sample: string }[];
  targetDb: string;
  universe: number;
}

// ---- dev-only DB-selector (STORY-035) transport DTOs ----
// Lists already-built market-data DBs and switches the active one at runtime.
export interface DatabaseEntry {
  name: string;
  path: string;
  sizeBytes: number;
  instruments: number | null; // null when not a readable STORY-031 DB
  valid: boolean;
  active: boolean;
}
export interface DatabasesResp {
  activeKind: 'synthetic' | 'sqlite';
  activePath: string | null;
  scanDir: string;
  databases: DatabaseEntry[];
}
// Switch to a SQLite DB by path, OR back to the synthetic generator.
export interface ActivateDbRequest { path?: string; synthetic?: boolean }
export interface ActivateDbReport {
  activeKind: 'synthetic' | 'sqlite';
  activePath: string | null;
  universe: number;
}

// The client-side read seam. Exposes exactly today's calls and nothing
// speculative (STORY-035 AC#1).
export interface MarketClient {
  facts(signal?: AbortSignal): Promise<FactsResp>;
  instrument(ticker: string): Promise<InstrumentBars | null>;
  screen(signal?: AbortSignal): Promise<ScreenResp>;
  signals(body: SignalsRequest, signal?: AbortSignal): Promise<SignalsResp>;
  backtest(
    config: FanBacktestConfig,
    onProgress?: (p: FanBacktestProgress) => void,
    signal?: AbortSignal,
  ): Promise<FanBacktestResult & { elapsedMs: number }>;
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
  | { type: 'progress'; name: number; total: number }
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
      return res.json() as Promise<InstrumentBars>;
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
      const res = await fetch('/signals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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
