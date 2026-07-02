// marketClient.timeout.test.ts — STORY-054 seam-level coverage for the bounded
// client-side timeout on the on-demand /instrument fetch (SAD#4.1 / SAD#5.10).
//
// The transport-resilience gap: `marketClient.instrument` issued a `fetch` with
// no client-side timeout, so a service that accepts the connection but never
// responds left the promise unsettled forever — and the store's in-flight de-dup
// guard blocks any recovery, stranding the detail/compare spinner. These tests
// pin the fix at the seam: the fetch carries an AbortSignal, a never-responding
// fetch aborts and REJECTS within the bound, and a normal fast response is
// unaffected. `fetch` is stubbed; no network.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpMarketClient } from '../src/lib/client/marketClient.ts';

const bars = { ticker: 'AAPL', name: 'Apple', sector: 'Tech', bars: [] };
const okRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

afterEach(() => { vi.unstubAllGlobals(); });

describe('STORY-054: instrument() bounded client-side timeout', () => {
  it('attaches an AbortSignal to the instrument fetch', async () => {
    const fetchMock = vi.fn(async () => okRes(bars));
    vi.stubGlobal('fetch', fetchMock);

    await httpMarketClient().instrument('AAPL');

    const init = fetchMock.mock.calls[0][1] as { signal?: unknown };
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts and rejects when the service accepts the connection but never responds', async () => {
    // The fetch never resolves on its own — it settles ONLY when the client's
    // timeout aborts the signal it attached, proving the timeout is what unsticks
    // an otherwise-perpetual pending fetch (not the server).
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject((init.signal as AbortSignal).reason));
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = httpMarketClient({ instrumentTimeoutMs: 20 });
    await expect(client.instrument('AAPL')).rejects.toBeInstanceOf(Error);
  });

  it('leaves a normal fast response unaffected by the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okRes(bars)));
    const out = await httpMarketClient({ instrumentTimeoutMs: 20 }).instrument('AAPL');
    expect(out).toEqual(bars);
  });

  it('still maps a 404 to null (the timeout does not change the not-found path)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null })));
    expect(await httpMarketClient({ instrumentTimeoutMs: 20 }).instrument('NOPE')).toBeNull();
  });
});
