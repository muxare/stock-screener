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

import type { InstrumentBars, BacktestResult, Rule } from '../market';

// Per-match row returned by /screen — mirrors `ScreenRow` in server/screen.ts.
// Carries the scalars the results table renders plus the 40-day sparkline, so a
// row draws without fetching that name's bars.
export interface Row {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  rsi: number;
  macdHist: number;
  stochK: number;
  relVol: number;
  ema20: number;
  ema50: number;
  ema200: number;
  pct52w: number;
  sparkline: number[];
}

export interface ScreenResp {
  total: number;
  count: number;
  offset: number;
  limit: number;
  elapsedMs: number;
  tickers: string[];
  results: Row[];
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

// The client-side read seam. Exposes exactly today's calls and nothing
// speculative (STORY-035 AC#1).
export interface MarketClient {
  /** Universe-wide facts: count + sector facets + a sample name. */
  facts(signal?: AbortSignal): Promise<FactsResp>;
  /** One name's bars, or `null` on 404. */
  instrument(ticker: string): Promise<InstrumentBars | null>;
  /** Run a rule set against the universe; `limit: 0` returns counts/tickers only. */
  screen(rules: Rule[], limit?: number, signal?: AbortSignal): Promise<ScreenResp>;
  /** Stream a full-universe backtest; resolves the single `result` payload (or `null`). */
  backtest(rules: Rule[], onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<BacktestResult | null>;
  /** Dev-only import options; `null` when DEV_TOOLS is off (or the service is down). */
  devImportOptions(): Promise<ImportOptionsResp | null>;
  /** Run a dev-only EOD import. */
  devImport(body: DevImportRequest): Promise<DevImportReport>;
}

// ----------------------------------------------------------------------------
// The production HTTP implementation. Same-origin paths; vite proxies them to
// the Node service in dev (vite.config.ts). Behaviour is a 1:1 move of the
// former `api*` helpers from src/store.ts — same endpoints, same error/null
// semantics, same NDJSON parse.
// ----------------------------------------------------------------------------
export function httpMarketClient(): MarketClient {
  return {
    async facts(signal) {
      const res = await fetch('/facts', { signal });
      if (!res.ok) throw new Error('facts failed: ' + res.status);
      return res.json() as Promise<FactsResp>;
    },

    async instrument(ticker) {
      const res = await fetch('/instrument/' + encodeURIComponent(ticker));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('instrument failed: ' + res.status);
      return res.json() as Promise<InstrumentBars>;
    },

    async screen(rules, limit = 0, signal) {
      const res = await fetch('/screen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules, limit }),
        signal,
      });
      if (!res.ok) throw new Error('screen failed: ' + res.status);
      return res.json() as Promise<ScreenResp>;
    },

    // NDJSON stream (SAD#2.4): throttled `progress` lines, then one `result` line
    // carrying the single summary payload (SAD#6.5).
    async backtest(rules, onProgress, signal) {
      const res = await fetch('/backtest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules }),
        signal,
      });
      if (!res.ok || !res.body) throw new Error('backtest failed: ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let result: BacktestResult | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { type: string; pct?: number; error?: string } & Record<string, unknown>;
          if (msg.type === 'progress') onProgress?.(msg.pct ?? 0);
          else if (msg.type === 'result') result = msg as unknown as BacktestResult;
          else if (msg.type === 'error') throw new Error(String(msg.error));
        }
      }
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
      const data = (await res.json().catch(() => ({}))) as { error?: string } & DevImportReport;
      if (!res.ok) throw new Error(data.error || 'import failed: ' + res.status);
      return data;
    },
  };
}
