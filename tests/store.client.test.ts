// store.client.test.ts — STORY-018 acceptance harness for the client wiring.
//
// Proves the web client (SAD#4.1) sources full-universe data from the screening
// service (SAD#4.2) instead of computing it in the browser (SAD#2.5 / AC1, AC4):
// the store's screen result, the "of N" total, sector facets, and preset match
// counts all arrive over HTTP/JSON, displayed names pull their bars on demand,
// and a backtest streams back from the service. The store talks to the SAME
// in-process server the other harnesses boot, over the shared engine.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createScreenServer } from '../server/index.ts';
import { createUniverseStore } from '../server/universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';

// Minimal in-memory localStorage (the store persists view prefs there).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

let close: () => Promise<void>;

beforeAll(async () => {
  const store = createUniverseStore(syntheticProvider(7));
  const server = createScreenServer(store);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));

  // The store fetches same-origin paths (vite proxies them in dev). In this
  // node harness, rewrite those relative paths onto the in-process server and
  // give the store a localStorage. Set up BEFORE importing the store.
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' && input.startsWith('/') ? base + input : input;
    return realFetch(url as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;
});

afterAll(() => close());

async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return pred();
}

// Swap globalThis.fetch for the duration of one action and always restore it
// (even on throw), so a stub can never leak into a later test. `makeStub` receives
// the real fetch so the stub can pass non-matching requests through.
async function withStubbedFetch<T>(
  makeStub: (real: typeof fetch) => typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = makeStub(saved);
  try { return await fn(); } finally { globalThis.fetch = saved; }
}

const urlOf = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string' ? input : String((input as Request).url ?? input);

describe('client sources full-universe data from the service (SAD#2.5)', () => {
  it('init() populates the screen result, total, sectors and preset counts over HTTP', async () => {
    const { useScreener } = await import('../src/store.ts');
    useScreener.getState().init();

    // The active screen lands from /screen (AC1/AC4); the universe-wide facts
    // (total, sectors) arrive from a parallel bootstrap fetch.
    expect(await waitFor(() => useScreener.getState().screen != null && useScreener.getState().universeSize > 0)).toBe(true);
    const st = useScreener.getState();
    expect(st.universeSize).toBe(44);              // the "of N" total
    expect(st.screen!.total).toBeGreaterThan(0);
    expect(st.screen!.rows.length).toBe(st.screen!.total); // full matched set, not a page
    expect(st.screen!.rows[0].sparkline.length).toBe(40);  // row carries its own spark
    expect(st.sectorList.length).toBeGreaterThan(0);        // sector facets

    // Per-preset match counts arrive from the service, not a local sweep.
    expect(await waitFor(() => Object.keys(useScreener.getState().presetCounts).length > 0)).toBe(true);
    expect(useScreener.getState().presetCounts['macdmomo']).toBeGreaterThanOrEqual(0);

    // A sample name for the indicator preview was fetched (displayed-name compute).
    expect(await waitFor(() => useScreener.getState().sampleStock != null)).toBe(true);
    expect(useScreener.getState().sampleStock!.full.c.length).toBeGreaterThan(0);
  });

  it('fetches bars on demand only for displayed names (SAD#4.1)', async () => {
    const { useScreener } = await import('../src/store.ts');
    const ticker = useScreener.getState().screen!.tickers[0];
    await useScreener.getState().ensureDisplayed(ticker);
    const stock = useScreener.getState().displayed[ticker];
    expect(stock?.ticker).toBe(ticker);
    expect(stock!.full.c.length).toBeGreaterThan(0); // built locally from the bars
  });

  it('previewCount returns a full-universe count for an ad-hoc rule set', async () => {
    const { useScreener } = await import('../src/store.ts');
    const all = await useScreener.getState().previewCount([]);
    expect(all).toBe(44); // empty rule set matches the whole universe
  });

  it('runs the backtest server-side and streams back a summary (SAD#2.4)', async () => {
    const { useScreener } = await import('../src/store.ts');
    useScreener.getState().openBacktest();
    expect(useScreener.getState().backtestRunning).toBe(true);
    expect(await waitFor(() => useScreener.getState().backtestResult != null, 15000)).toBe(true);
    const r = useScreener.getState().backtestResult!;
    expect(typeof r.signals).toBe('number');
    expect(Array.isArray(r.horizons)).toBe(true);
    expect(useScreener.getState().backtestRunning).toBe(false);
  });
});

// Service failures must surface as an explicit error/unknown state, never as a
// confident zero result — these lock the three review blockers fixed on this
// branch (the client must not coerce a failed call to "0 matches" / "never
// fired"). Each test swaps in a rejecting fetch for the duration of one action.
describe('service failures are not misreported as zero results', () => {
  const withBrokenFetch = <T,>(match: string, fn: () => Promise<T>): Promise<T> =>
    withStubbedFetch((real) => ((input, init) =>
      urlOf(input).includes(match) ? Promise.reject(new Error('simulated outage')) : real(input, init)
    ) as typeof fetch, fn);

  it('previewCount returns null (unknown), not 0, when the service is unreachable (finding 2)', async () => {
    const { useScreener } = await import('../src/store.ts');
    const n = await withBrokenFetch('/screen', () => useScreener.getState().previewCount([]));
    expect(n).toBeNull(); // a builder rendering this as "0 matches" would mislead the user
  });

  it('a failed backtest sets backtestError and leaves no zero-signal result (finding 1)', async () => {
    const { useScreener } = await import('../src/store.ts');
    await withBrokenFetch('/backtest', async () => {
      useScreener.getState().openBacktest();
      expect(await waitFor(() => !useScreener.getState().backtestRunning, 15000)).toBe(true);
    });
    const st = useScreener.getState();
    expect(st.backtestError).toBeTruthy();   // distinct error state, not "never fired"
    expect(st.backtestResult).toBeNull();    // no phantom zero-signal result
  });
});

// STORY-028 — bootstrap derives the universe facts (count + sectors) from a
// count/facets-only endpoint, NOT from a full-universe `ALL_ROWS` screen whose
// per-name rows (each with a 40-point sparkline) were all discarded. These hit
// the in-process server over the same proxied fetch the store uses.
describe('STORY-028: universe facts come from a facts-only payload (no rows)', () => {
  it('GET /facts returns total + sectors + sample and serialises NO per-name rows', async () => {
    const facts = await fetch('/facts').then((r) => r.json());
    expect(facts.total).toBe(44);                       // same "of N" total as before
    expect(Array.isArray(facts.sectors)).toBe(true);
    expect(facts.sectors.length).toBeGreaterThan(0);    // sector facets present
    expect(typeof facts.sample).toBe('string');         // a sample name for the preview
    // The whole point of the story: this call carries no row/sparkline payload.
    expect('results' in facts).toBe(false);
    expect(JSON.stringify(facts)).not.toContain('sparkline');
  });

  it('bootstrap populates universeSize + sectorList from /facts, not an ALL_ROWS screen', async () => {
    const { useScreener } = await import('../src/store.ts');
    // Fail any full-row `/screen` (limit >= ALL_ROWS) during bootstrap; the facts
    // path must not depend on it. The reactive screen still runs separately.
    await withStubbedFetch((real) => ((input, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (urlOf(input).includes('/screen') && body.limit >= 1_000_000) {
        return Promise.reject(new Error('bootstrap must not pull full rows for facts'));
      }
      return real(input, init);
    }) as typeof fetch, async () => {
      useScreener.setState({ universeSize: 0, sectorList: [], sampleStock: null });
      await useScreener.getState().bootstrap();
      const st = useScreener.getState();
      expect(st.universeSize).toBe(44);
      expect(st.sectorList.length).toBeGreaterThan(0);
    });
  });
});

// STORY-027 — recover after a service outage AT LOAD (SAD#5.9 store). If the
// service is down at boot, the app must not stay empty until an unrelated rule
// edit: an explicit Retry re-fetches the universe facts and re-runs the screen,
// and the indicator-builder preview lazy-loads its sample when the builder opens.
describe('STORY-027: the app recovers once the service becomes reachable', () => {
  it('retry recovers after a load-time outage: re-populates screen + facts (finding 9)', async () => {
    const { useScreener } = await import('../src/store.ts');
    // Phase 1 — service down at "load": both bootstrap and the screen fail.
    useScreener.setState({ universeSize: 0, sectorList: [], screen: null, screenError: null });
    await withStubbedFetch(() => (() => Promise.reject(new Error('simulated outage'))) as typeof fetch, async () => {
      await Promise.all([useScreener.getState().bootstrap(), useScreener.getState().runScreen()]);
    });
    let st = useScreener.getState();
    expect(st.screenError).toBeTruthy();   // unavailable banner is shown
    expect(st.universeSize).toBe(0);       // no facts yet
    expect(st.screen).toBeNull();          // no rows yet

    // Phase 2 — service reachable again: explicit Retry restores everything
    // (real fetch is proxied to the in-process server by the harness).
    await useScreener.getState().retry();
    st = useScreener.getState();
    expect(st.screenError).toBeNull();                       // banner cleared
    expect(st.universeSize).toBe(44);                        // "of N" restored
    expect(st.sectorList.length).toBeGreaterThan(0);         // sectors restored
    expect(st.screen!.rows.length).toBe(st.screen!.total);   // rows restored
  });

  it('indicator-builder sample preview recovers after an initial failure (finding 10)', async () => {
    const { useScreener } = await import('../src/store.ts');
    useScreener.setState({ sampleStock: null });
    // Boot fetch failed → ensureSampleStock cannot load a sample; preview stays "—".
    await withStubbedFetch(() => (() => Promise.reject(new Error('simulated outage'))) as typeof fetch, async () => {
      await useScreener.getState().ensureSampleStock();
    });
    expect(useScreener.getState().sampleStock).toBeNull();

    // Service reachable: opening the builder lazily fetches the sample name.
    useScreener.getState().openBuilder();
    expect(await waitFor(() => useScreener.getState().sampleStock != null)).toBe(true);
    expect(useScreener.getState().sampleStock!.full.c.length).toBeGreaterThan(0);
  });
});

// STORY-025 — request sequencing in the client store (SAD#5.9). Moving screen &
// backtest to async service calls removed the synchronous guarantees of the old
// in-browser compute: responses race, streams overlap, and selection outlives the
// rows it pointed at. These tests stub fetch with controlled timing/payloads so a
// slow earlier response genuinely lands AFTER a newer one — proving the
// generation guard (not request ordering) is what keeps state correct.
describe('STORY-025: rapid re-runs never show stale or mismatched results', () => {
  // A Response-like good enough for the store's `res.ok` + `res.json()` use.
  function jsonResponse(obj: unknown): Response {
    return { ok: true, status: 200, json: async () => obj } as unknown as Response;
  }
  function screenPayload(tickers: string[]) {
    return {
      total: tickers.length, count: tickers.length, offset: 0, limit: 1_000_000, elapsedMs: 1,
      tickers,
      // Rows only need a `ticker`/`sector` for the store; the sequencing tests
      // assert on `screen.tickers`, so a minimal row shape is enough.
      results: tickers.map((t) => ({ ticker: t, name: t, sector: 'Tech', sparkline: [] })),
    };
  }
  // NDJSON streaming Response whose reader ignores abort and only yields its lines
  // after `gate` resolves, so a superseded stream still arrives later and we prove
  // the generation guard drops it. Returns `done`, which resolves once the reader
  // is fully drained — letting the test await completion deterministically.
  function ndjsonStream(lines: string[], gate: Promise<void>): { res: Response; done: Promise<void> } {
    const enc = new TextEncoder();
    let i = 0;
    let signalDone!: () => void;
    const done = new Promise<void>((r) => { signalDone = r; });
    const res = {
      ok: true, status: 200,
      body: { getReader: () => ({
        read: () => gate.then(() => {
          if (i >= lines.length) { signalDone(); return { done: true, value: undefined }; }
          return { done: false, value: enc.encode(lines[i++] + '\n') };
        }),
      }) },
    } as unknown as Response;
    return { res, done };
  }

  // Flush pending microtasks so a resolved promise's `.then` (e.g. the store's
  // own commit) runs before we assert — deterministic, no wall-clock margin.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('out-of-order /screen responses commit the newest only (finding 4)', async () => {
    const { useScreener } = await import('../src/store.ts');
    // The first full-universe screen resolves only when we release it (`release`),
    // the second resolves immediately with ['NEW']. We commit 'NEW', THEN release
    // the stale 'OLD' response and await it — proving the generation guard (not
    // arrival order) is what drops it. The stub ignores the abort signal on purpose.
    let releaseOld!: () => void;
    const oldLanded = new Promise<void>((r) => { releaseOld = r; });
    let call = 0;
    await withStubbedFetch((real) => ((input, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (urlOf(input).includes('/screen') && body.limit >= 1_000_000) {
        const isFirst = call++ === 0;
        if (isFirst) return oldLanded.then(() => jsonResponse(screenPayload(['OLD'])));
        return Promise.resolve(jsonResponse(screenPayload(['NEW'])));
      }
      if (urlOf(input).includes('/screen')) return Promise.resolve(jsonResponse(screenPayload([])));
      return real(input, init);
    }) as typeof fetch, async () => {
      const run1 = useScreener.getState().runScreen(); // pending → OLD
      const run2 = useScreener.getState().runScreen(); // resolves now → NEW (newest gen)
      await run2;
      expect(useScreener.getState().screen!.tickers).toEqual(['NEW']);
      releaseOld();            // now let the stale 'OLD' response arrive…
      await run1; await flush();
      expect(useScreener.getState().screen!.tickers).toEqual(['NEW']); // …it must NOT overwrite
    });
  });

  it('a superseded backtest stream does not overwrite the current result (finding 5)', async () => {
    const { useScreener } = await import('../src/store.ts');
    // Backtest stream gated on `release`: it only yields its `result` line after we
    // close the modal, so we can deterministically prove the stale `.then` is dropped.
    let releaseStream!: () => void;
    const streamReleased = new Promise<void>((r) => { releaseStream = r; });
    const drained = ndjsonStream([
      JSON.stringify({ type: 'progress', pct: 50 }),
      JSON.stringify({ type: 'result', signals: 999, horizons: [] }),
    ], streamReleased);
    await withStubbedFetch((real) => ((input, init) =>
      urlOf(input).includes('/backtest') ? Promise.resolve(drained.res) : real(input, init)
    ) as typeof fetch, async () => {
      useScreener.getState().openBacktest();
      expect(useScreener.getState().backtestRunning).toBe(true);
      useScreener.getState().closeBacktest(); // supersede the in-flight stream
      releaseStream();                         // let the superseded stream finish
      await drained.done; await flush();       // its `.then` has now had its chance
      expect(useScreener.getState().backtestResult).toBeNull(); // stale result dropped
    });
  });

  it('a rule change drops a selection that is no longer a match (finding 6)', async () => {
    const { useScreener } = await import('../src/store.ts');
    // The next screen returns a set that excludes the current selection / compare.
    await withStubbedFetch((real) => ((input, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (urlOf(input).includes('/screen') && body.limit >= 1_000_000) {
        return Promise.resolve(jsonResponse(screenPayload(['KEEP', 'ALSO'])));
      }
      if (urlOf(input).includes('/screen')) return Promise.resolve(jsonResponse(screenPayload([])));
      return real(input, init);
    }) as typeof fetch, async () => {
      // Seed a selection + compare set that the new screen will not contain.
      useScreener.setState({ selected: 'GONE', compareSel: ['GONE', 'KEEP'] });
      await useScreener.getState().runScreen();
      const st = useScreener.getState();
      expect(st.screen!.tickers).toEqual(['KEEP', 'ALSO']);
      expect(st.selected).toBeNull();            // absent selection cleared
      expect(st.compareSel).toEqual(['KEEP']);   // absent compare entry dropped, present one kept
    });
  });
});
