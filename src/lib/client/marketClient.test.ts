// marketClient.test.ts — acceptance tests for the HTTP MarketClient seam
// (STORY-035 AC#5). Each test maps to a requirement: endpoint shapes (path,
// method, body, forwarded AbortSignal), `404 → null` for instrument, NDJSON
// progress→result parsing for backtest, `null` dev-import options when the
// endpoint 404s, and `throw on !res.ok`. `fetch` is stubbed; no network.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpMarketClient } from './marketClient';

// A minimal Response-like for the JSON endpoints.
function jsonRes(body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) {
  return { ok, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpMarketClient.facts', () => {
  it('GETs /facts and returns the parsed body, forwarding the AbortSignal', async () => {
    const facts = { total: 3, sectors: ['Tech'], sample: 'AAPL' };
    fetchMock.mockResolvedValue(jsonRes(facts));
    const ac = new AbortController();
    const out = await httpMarketClient().facts(ac.signal);
    expect(out).toEqual(facts);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/facts');
    expect(opts.signal).toBe(ac.signal);
  });

  it('throws on !res.ok', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, { ok: false, status: 500 }));
    await expect(httpMarketClient().facts()).rejects.toThrow('facts failed: 500');
  });
});

describe('httpMarketClient.instrument', () => {
  it('GETs /instrument/<ticker> with the ticker URL-encoded', async () => {
    const bars = { ticker: 'A/B', name: 'Slashy', sector: 'Fin', bars: [] };
    fetchMock.mockResolvedValue(jsonRes(bars));
    const out = await httpMarketClient().instrument('A/B');
    expect(out).toEqual(bars);
    // A URL-special char ('/') makes the encoded path differ from the raw one,
    // so a dropped encodeURIComponent would fail this assertion.
    expect(fetchMock.mock.calls[0][0]).toBe('/instrument/A%2FB');
  });

  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, { ok: false, status: 404 }));
    expect(await httpMarketClient().instrument('NOPE')).toBeNull();
  });

  it('throws on other non-ok statuses', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, { ok: false, status: 500 }));
    await expect(httpMarketClient().instrument('AAPL')).rejects.toThrow('instrument failed: 500');
  });
});

describe('httpMarketClient.screen', () => {
  it('POSTs /screen with an empty JSON body and forwards the signal', async () => {
    const resp = { universe: 1, elapsedMs: 1, matches: [], near: [] };
    fetchMock.mockResolvedValue(jsonRes(resp));
    const ac = new AbortController();
    const out = await httpMarketClient().screen(ac.signal);
    expect(out).toEqual(resp);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/screen');
    expect(opts.method).toBe('POST');
    expect(opts.signal).toBe(ac.signal);
    expect(JSON.parse(opts.body)).toEqual({});
  });

  it('throws on !res.ok', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, { ok: false, status: 400 }));
    await expect(httpMarketClient().screen()).rejects.toThrow('screen failed: 400');
  });
});

function ndjsonRes(lines: string[]) {
  const text = lines.map((l) => l + '\n').join('');
  const bytes = new TextEncoder().encode(text);
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
        };
      },
    },
  };
}

describe('httpMarketClient.backtest', () => {
  const cfg = {
    strategy: 'onset' as const,
    entry: 'match' as const,
    targetR: 3,
    macdWindow: false,
    maxHoldBars: 60,
    horizons: [5],
  };

  it('POSTs /backtest and parses NDJSON progress then result', async () => {
    const result = {
      type: 'result', elapsedMs: 12, config: cfg, universe: 2, stocksScanned: 2,
      totalEntries: 1, stocksWithEntries: 1, forwardHorizons: [],
      trades: { count: 1, winRate: 100, avgReturnPct: 2, medianReturnPct: 2, avgBarsHeld: 5, byExitReason: {} },
      entries: [],
    };
    fetchMock.mockResolvedValue(ndjsonRes([
      JSON.stringify({ type: 'progress', name: 1, total: 2 }),
      JSON.stringify(result),
    ]));
    const progress: { name: number; total: number }[] = [];
    const out = await httpMarketClient().backtest(cfg, (p) => progress.push(p));
    expect(fetchMock.mock.calls[0][0]).toBe('/backtest');
    expect(progress).toEqual([{ name: 1, total: 2 }]);
    expect(out.totalEntries).toBe(1);
    expect(out.elapsedMs).toBe(12);
  });

  it('throws a restart hint on 404 (stale Vite proxy)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('empty'); } });
    await expect(httpMarketClient().backtest(cfg)).rejects.toThrow(/restart the Vite dev server/);
  });
});

describe('httpMarketClient.devImportOptions', () => {
  it('returns the parsed options on success', async () => {
    const opts = { configs: [], dataDir: '/d', dataEntries: [], targetDb: 'dev.db' };
    fetchMock.mockResolvedValue(jsonRes(opts));
    expect(await httpMarketClient().devImportOptions()).toEqual(opts);
    expect(fetchMock.mock.calls[0][0]).toBe('/dev/import/options');
  });

  it('returns null when the endpoint is not ok (DEV_TOOLS off / service down)', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, { ok: false, status: 404 }));
    expect(await httpMarketClient().devImportOptions()).toBeNull();
  });
});

describe('httpMarketClient.devImport', () => {
  it('POSTs /dev/import and returns the report', async () => {
    const report = { files: 1, instruments: 2, bars: 3, skipped: 0, errors: [], targetDb: 'dev.db', universe: 2 };
    fetchMock.mockResolvedValue(jsonRes(report));
    const out = await httpMarketClient().devImport({ configName: 'yf' });
    expect(out).toEqual(report);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/dev/import');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ configName: 'yf' });
  });

  it('throws the service-provided error message on !res.ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'bad config' }, { ok: false, status: 400 }));
    await expect(httpMarketClient().devImport({ configName: 'x' })).rejects.toThrow('bad config');
  });

  it('falls back to a status message when the error body is unparseable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('no json'); } });
    await expect(httpMarketClient().devImport({ configName: 'x' })).rejects.toThrow('import failed: 500');
  });

  it('throws when a 2xx body cannot be parsed as JSON (no blank success)', async () => {
    // A truncated/garbage OK body must not return `{}` cast as a blank report.
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('unexpected end of JSON'); } });
    await expect(httpMarketClient().devImport({ configName: 'x' })).rejects.toThrow('response body was not valid JSON');
  });
});

// activateDatabase shared the same two-path parse anti-pattern as devImport; the
// STORY-036 fix was extended to it (same root cause, same file).
describe('httpMarketClient.activateDatabase', () => {
  it('POSTs /dev/databases/activate and returns the report', async () => {
    const report = { activeKind: 'sqlite', activePath: '/d/dev.db', universe: 5 };
    fetchMock.mockResolvedValue(jsonRes(report));
    const out = await httpMarketClient().activateDatabase({ path: '/d/dev.db' });
    expect(out).toEqual(report);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/dev/databases/activate');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ path: '/d/dev.db' });
  });

  it('throws the service-provided error message on !res.ok', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'no such db' }, { ok: false, status: 400 }));
    await expect(httpMarketClient().activateDatabase({ path: '/nope' })).rejects.toThrow('no such db');
  });

  it('falls back to a status message when the error body is unparseable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('no json'); } });
    await expect(httpMarketClient().activateDatabase({ synthetic: true })).rejects.toThrow('activate failed: 500');
  });

  it('throws when a 2xx body cannot be parsed as JSON (no blank success)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('unexpected end of JSON'); } });
    await expect(httpMarketClient().activateDatabase({ synthetic: true })).rejects.toThrow('response body was not valid JSON');
  });
});
