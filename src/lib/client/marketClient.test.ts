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

// A Response-like whose body streams the given raw string chunks, one per
// reader.read() — so callers can split NDJSON lines ACROSS reads and exercise
// the cross-chunk buffer reassembly.
function streamRes(chunks: string[], { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          read: async () => (i < chunks.length
            ? { value: enc.encode(chunks[i++]), done: false }
            : { value: undefined, done: true }),
        };
      },
    },
  };
}

// Convenience: NDJSON lines delivered as one chunk.
function ndjsonRes(lines: string[], opts: { ok?: boolean; status?: number } = {}) {
  return streamRes([lines.map((l) => l + '\n').join('')], opts);
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
  it('POSTs /screen with {rules, limit} and forwards the signal', async () => {
    const resp = { total: 1, count: 1, offset: 0, limit: 0, elapsedMs: 1, tickers: ['AAPL'], results: [] };
    fetchMock.mockResolvedValue(jsonRes(resp));
    const ac = new AbortController();
    const rules = [{ kind: 'flag', field: 'up' }] as never;
    const out = await httpMarketClient().screen(rules, 10, ac.signal);
    expect(out).toEqual(resp);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/screen');
    expect(opts.method).toBe('POST');
    expect(opts.signal).toBe(ac.signal);
    expect(JSON.parse(opts.body)).toEqual({ rules, limit: 10 });
  });

  it('defaults limit to 0 when omitted', async () => {
    fetchMock.mockResolvedValue(jsonRes({ tickers: [], results: [] }));
    await httpMarketClient().screen([] as never);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ rules: [], limit: 0 });
  });

  it('throws on !res.ok', async () => {
    fetchMock.mockResolvedValue(jsonRes(null, { ok: false, status: 400 }));
    await expect(httpMarketClient().screen([] as never)).rejects.toThrow('screen failed: 400');
  });
});

describe('httpMarketClient.backtest', () => {
  it('parses NDJSON progress lines then the result line', async () => {
    const result = { type: 'result', trades: 5, ret: 1.2 };
    fetchMock.mockResolvedValue(ndjsonRes([
      JSON.stringify({ type: 'progress', pct: 25 }),
      JSON.stringify({ type: 'progress', pct: 80 }),
      JSON.stringify(result),
    ]));
    const progress: number[] = [];
    const out = await httpMarketClient().backtest([] as never, (p) => progress.push(p));
    expect(progress).toEqual([25, 80]);
    expect(out).toEqual(result);
  });

  it('reassembles lines that straddle reader chunks', async () => {
    const result = { type: 'result', trades: 7, ret: 3.4 };
    const full = [
      JSON.stringify({ type: 'progress', pct: 40 }),
      JSON.stringify(result),
    ].map((l) => l + '\n').join('');
    // Split at fixed offsets that land mid-line, so both the `buf` carry and the
    // streaming TextDecoder must stitch the JSON back together.
    fetchMock.mockResolvedValue(streamRes([full.slice(0, 8), full.slice(8, 30), full.slice(30)]));
    const progress: number[] = [];
    const out = await httpMarketClient().backtest([] as never, (p) => progress.push(p));
    expect(progress).toEqual([40]);
    expect(out).toEqual(result);
  });

  it('forwards the AbortSignal to fetch', async () => {
    fetchMock.mockResolvedValue(ndjsonRes([JSON.stringify({ type: 'result', ok: true })]));
    const ac = new AbortController();
    await httpMarketClient().backtest([] as never, undefined, ac.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(ac.signal);
  });

  it('returns null when the stream carries no result line', async () => {
    fetchMock.mockResolvedValue(ndjsonRes([JSON.stringify({ type: 'progress', pct: 50 })]));
    expect(await httpMarketClient().backtest([] as never)).toBeNull();
  });

  it('throws when the stream carries an error line', async () => {
    fetchMock.mockResolvedValue(ndjsonRes([JSON.stringify({ type: 'error', error: 'boom' })]));
    await expect(httpMarketClient().backtest([] as never)).rejects.toThrow('boom');
  });

  it('throws on !res.ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, body: null });
    await expect(httpMarketClient().backtest([] as never)).rejects.toThrow('backtest failed: 503');
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
});
