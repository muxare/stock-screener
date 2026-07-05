// dev-proxy-coverage.test.ts — STORY-030 (CAP-screen). A build-time guard that
// every same-origin path the CLIENT app fetches has a matching Vite dev-proxy
// entry, so a newly added service endpoint can't silently pass the in-process
// test harness (which rewrites globalThis.fetch to hit the server directly,
// bypassing the Vite proxy — tests/store.client.test.ts) yet 404 in the real
// browser via the SPA fallback. That is exactly the STORY-028/021 defect
// (`/facts`, `/metrics` reached Vite's HTML fallback, so `apiFacts()` parsed
// HTML and bootstrap left the universe empty) this makes impossible to
// reintroduce. The client talks to the SAD#4.2 service over same-origin
// HTTP/JSON (SAD#4.1); every such path must be reachable in dev via the proxy.
//
// AC DRIFT (post-STORY-035): the AC names `src/store.ts` and lists `/metrics`
// among the client fetches, but the client-injection refactor (STORY-035) moved
// every app `fetch()` into `src/lib/client/marketClient.ts` — the store now
// consumes an injected client and calls no `fetch` itself — and `/metrics` is a
// SERVER endpoint (server/index.ts, SAD#4.2) fetched only by the store.client
// test harness, never by app code. So the fetched paths are derived from the
// actual app source (`src/**`, excluding tests) rather than store.ts, and
// `/metrics` is pinned as a known server-only same-origin endpoint. The guard's
// intent — no client fetch without a proxy entry — is delivered faithfully.
// This is a static/build-time check (SAD#5.9): it parses source text and never
// starts a live Vite server or the service.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// Every non-test .ts/.tsx file under src/ (the app source we scan for fetches).
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// The first path segment of every same-origin `fetch('/seg…')` literal in the
// app source. Derived FROM SOURCE (not a hard-coded list), so a newly added
// client fetch is picked up automatically — the anti-drift property (AC#2).
//
// LIMITATION: this matches only a fetch whose first argument is a literal
// beginning with `/` — the pattern every current app fetch uses. An INDIRECTED
// fetch (`fetch(apiUrl('/x'))`, `` fetch(`${BASE}/x`) ``, or a computed path)
// would evade this static scan; if a future endpoint is added that way, promote
// this to an AST-based scan or add its segment to the check deliberately.
function clientFetchedSegments(): Set<string> {
  const segs = new Set<string>();
  const re = /fetch\(\s*[`'"]\/([a-zA-Z][\w-]*)/g;
  for (const file of walk(join(ROOT, 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) segs.add(m[1]);
  }
  return segs;
}

// The first path segment of every dev `server.proxy` key in vite.config.ts,
// parsed from source text (no config execution, no running server).
function proxySegments(): Set<string> {
  const cfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
  const block = cfg.slice(cfg.indexOf('proxy:')); // only the proxy map's keys
  const segs = new Set<string>();
  for (const m of block.matchAll(/['"]\/([a-zA-Z][\w-]*)['"]\s*:/g)) segs.add(m[1]);
  return segs;
}

// Same-origin endpoints the browser can reach in dev but the app JS does not
// fetch — served by the SAD#4.2 service (server/index.ts) and proxied for dev
// access. Kept tiny and explicit so a genuinely dead proxy entry still fails.
const KNOWN_SERVER_ONLY = new Set(['metrics']);

describe('dev proxy covers every client-fetched same-origin path (STORY-030)', () => {
  const fetched = clientFetchedSegments();
  const proxied = proxySegments();

  it('discovers the app’s same-origin fetches from source (scan is not vacuous)', () => {
    for (const p of ['screen', 'backtest', 'instrument', 'facts', 'dev']) {
      expect([...fetched]).toContain(p);
    }
  });

  it('every client-fetched path has a matching dev-proxy entry (AC#1/AC#2)', () => {
    // A new client fetch added without a corresponding proxy entry fails here.
    const missing = [...fetched].filter((s) => !proxied.has(s));
    expect(missing).toEqual([]);
  });

  it('has no dead proxy entry — each is client-fetched or a known service endpoint', () => {
    const orphans = [...proxied].filter((s) => !fetched.has(s) && !KNOWN_SERVER_ONLY.has(s));
    expect(orphans).toEqual([]);
    for (const k of KNOWN_SERVER_ONLY) expect([...proxied]).toContain(k);
  });

  it('is sensitive: removing any current proxy entry makes it red (AC#3)', () => {
    // Proven mechanically for EVERY current entry: a proxy set missing it fails
    // either the coverage check (a client-fetched entry) or the known-server-only
    // pin (/metrics) — so no current entry is dead weight.
    for (const entry of proxied) {
      const without = new Set([...proxied].filter((s) => s !== entry));
      const breaksCoverage = [...fetched].some((s) => !without.has(s));
      const breaksKnownPin = [...KNOWN_SERVER_ONLY].some((s) => !without.has(s));
      expect(breaksCoverage || breaksKnownPin).toBe(true);
    }
  });
});
