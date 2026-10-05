// app.test.ts — the routing layer itself (hardening 2.3).
//
// Before this file the router had essentially no coverage: the endpoint tests
// went through it to reach a handler, but nothing exercised what the router does
// when a request is *wrong* — an unknown path, a body that is not JSON, a content
// type the service does not speak, a handler that throws something other than a
// RequestError. Those paths were exactly the ones phase 2.1 rewrote.
//
// Most cases use `app.inject()`, which runs the full Fastify lifecycle (routing,
// content-type parsing, hooks, error handler, serialisation) without binding a
// socket. The cases that genuinely need the wire — the NDJSON stream, the
// keep-alive drain — live in `fanBacktest.test.ts` and `shutdown.test.ts`.

import { describe, it, expect, beforeAll } from 'vitest';
import { pino } from 'pino';
import { Writable } from 'node:stream';
import { buildApp } from './app.ts';
import { createUniverseStore } from './universe.ts';
import type { UniverseStore } from './universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { handleScreen, handleSignals } from './handlers.ts';
import type { ScreenResponse, SignalsResponse } from './handlers.ts';
import { parseFanSignalsBody } from './signals.ts';

const store = createUniverseStore(syntheticProvider(7));
beforeAll(() => { store.get(); });

const app = () => buildApp({ store, logger: false, devTools: false });
const json = (payload: unknown) => ({
  headers: { 'content-type': 'application/json' },
  payload: JSON.stringify(payload),
});

describe('routing', () => {
  it('answers an unknown path with the service 404 shape', async () => {
    const res = await app().inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('answers a known path with the wrong method with 404 rather than a handler', async () => {
    const res = await app().inject({ method: 'GET', url: '/screen' });
    expect(res.statusCode).toBe(404);
  });

  it('serves the read endpoints', async () => {
    const a = app();
    const health = await a.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toEqual({ ok: true, universe: 44 });

    const facts = await a.inject({ method: 'GET', url: '/facts' });
    expect(facts.statusCode).toBe(200);
    expect(facts.json<{ total: number }>().total).toBe(44);

    const metrics = await a.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json<Record<string, unknown>>()).toHaveProperty('screen');
    expect(metrics.json<Record<string, unknown>>()).toHaveProperty('backtest');
  });

  it('serves and 404s /instrument/:ticker, and 400s a path it cannot decode', async () => {
    const a = app();
    expect((await a.inject({ method: 'GET', url: '/instrument/AAPL' })).statusCode).toBe(200);

    const unknown = await a.inject({ method: 'GET', url: '/instrument/NOPE' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'unknown ticker' });

    // A malformed percent-encoding is refused by the router before any handler
    // runs, and comes back in the same error shape as everything else.
    const bad = await a.inject({ method: 'GET', url: '/instrument/%E0%A4%A' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: string }>().error).toBeTruthy();
  });
});

describe('request bodies', () => {
  it('accepts a bodyless POST, because /screen has never read its body', async () => {
    const res = await app().inject({ method: 'POST', url: '/screen' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ universe: number }>().universe).toBe(44);
  });

  it('accepts an empty JSON body as an empty object', async () => {
    // Fastify's stock parser answers 400 to this; the hand-rolled reader resolved
    // `{}`, and `/signals` relies on reaching its own parser to say what is missing.
    const res = await app().inject({
      method: 'POST', url: '/signals', headers: { 'content-type': 'application/json' }, payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'unknown or missing strategy' });
  });

  it('rejects a malformed JSON body as a 400 in the service error shape', async () => {
    const res = await app().inject({
      method: 'POST', url: '/screen', headers: { 'content-type': 'application/json' }, payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid JSON body' });
  });

  it('refuses every content type a cross-origin form can post', async () => {
    // text/plain, multipart/form-data and application/x-www-form-urlencoded are
    // the three a form can send without a preflight. The service parses JSON and
    // nothing else, so all three stop at 415 before a body is read — the property
    // the deleted `requireJson` gave `/dev/*`, now covering every route.
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const res = await app().inject({ method: 'POST', url: '/screen', headers: { 'content-type': ct }, payload: 'a=1' });
      expect(res.statusCode, ct).toBe(415);
      // Still the service's one error shape, not Fastify's default envelope.
      expect(Object.keys(res.json<object>()), ct).toEqual(['error']);
    }
  });

  it('caps a body at 1 MiB', async () => {
    const res = await app().inject({
      method: 'POST',
      url: '/screen',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(1 << 21) }),
    });
    expect(res.statusCode).toBe(413);
    expect(Object.keys(res.json<object>())).toEqual(['error']);
  });
});

describe('error mapping', () => {
  // A store whose universe read fails is the cheapest stand-in for "something
  // inside the service broke": not a RequestError, so a 500 — and a 500 that is
  // logged, because the alternative is a silent one.
  const brokenStore: UniverseStore = {
    get() { throw new Error('the provider is on fire'); },
    getInstrument() { return null; },
    reload() {},
    source() { return { kind: 'synthetic' }; },
    close() {},
  };

  it('answers an unexpected failure with a flat 500 that leaks nothing', async () => {
    const res = await buildApp({ store: brokenStore, logger: false, devTools: false })
      .inject({ method: 'POST', url: '/screen' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal error' });
    expect(res.body).not.toContain('on fire');
  });

  it('logs the cause of a 500, with the id of the request that caused it', async () => {
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) { lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>); cb(); },
    });
    const app500 = buildApp({ store: brokenStore, devTools: false, logger: pino({ level: 'info' }, sink) });
    await app500.inject({ method: 'POST', url: '/screen' });

    const failure = lines.find((l) => l.msg === 'request failed');
    expect(failure, 'a 500 must never be silent').toBeTruthy();
    expect((failure!.err as { message: string }).message).toBe('the provider is on fire');
    // Fastify's per-request child logger stamps every line with the request id,
    // so the failure can be tied to the request that caused it.
    expect(failure!.reqId).toBeTruthy();
    expect(lines.filter((l) => l.reqId === failure!.reqId).length).toBeGreaterThan(1);
  });
});

describe('the DEV_TOOLS gate is structural', () => {
  const devPaths = [
    ['GET', '/dev/import/options'],
    ['GET', '/dev/databases'],
    ['POST', '/dev/import'],
    ['POST', '/dev/databases/activate'],
  ] as const;

  it('does not register the /dev/* plugin when the flag is off', async () => {
    const off = buildApp({ store, logger: false, devTools: false });
    for (const [method, url] of devPaths) {
      const res = await off.inject({ method, url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual({ error: 'not found' });
    }
  });

  it('registers it when the flag is on', async () => {
    const on = buildApp({ store, logger: false, devTools: true });
    const options = await on.inject({ method: 'GET', url: '/dev/import/options' });
    expect(options.statusCode).toBe(200);
    expect(options.json<{ configs: unknown[] }>().configs.length).toBeGreaterThan(0);

    const dbs = await on.inject({ method: 'GET', url: '/dev/databases' });
    expect(dbs.statusCode).toBe(200);
    expect(dbs.json<{ activeKind: string }>().activeKind).toBe('synthetic');
  });

  it('answers a dev POST with an empty body as a 400, not a 500', async () => {
    // The deleted `requireJson` used to reject these before the body was read. It
    // is not needed: the handlers validate their own input, so a request that
    // arrives with nothing useful in it gets the RequestError it deserves rather
    // than a TypeError dressed up as a 500.
    const on = buildApp({ store, logger: false, devTools: true });
    const imported = await on.inject({
      method: 'POST', url: '/dev/import', headers: { 'content-type': 'application/json' }, payload: '',
    });
    expect(imported.statusCode).toBe(400);
    expect(imported.json()).toEqual({ error: 'configName is required' });

    const activate = await on.inject({ method: 'POST', url: '/dev/databases/activate', ...json({}) });
    expect(activate.statusCode).toBe(400);
    expect(activate.json<{ error: string }>().error).toMatch(/provide a database path/);
  });

  it('refuses a dev POST that does not declare JSON, which is what guards them', async () => {
    // `/dev/import` builds a database and `/dev/databases/activate` hot-swaps the
    // dataset for everyone, so a cross-origin form must not be able to reach
    // either. Both stop at 415 before their body is read.
    const on = buildApp({ store, logger: false, devTools: true });
    for (const url of ['/dev/import', '/dev/databases/activate']) {
      const res = await on.inject({ method: 'POST', url, headers: { 'content-type': 'text/plain' }, payload: 'x' });
      expect(res.statusCode, url).toBe(415);
    }
  });
});

describe('schemas (hardening 2.2)', () => {
  // Each POST route, with a body that is valid JSON of the wrong shape. Every one
  // is refused before its handler runs, in the service's one error shape, and
  // the message names the field — Zod's default does not, so `validate.ts` adds it.
  const malformed = [
    ['/screen', '{ not json', 'invalid JSON body'],
    ['/signals', JSON.stringify({ strategy: 'tag50', minAvgVol: 'lots' }), 'minAvgVol: Invalid input: expected number, received string'],
    ['/backtest', JSON.stringify({ strategy: 7 }), 'strategy must be a preset id or a definition object'],
    ['/backtest', JSON.stringify([1, 2]), 'body: Invalid input: expected object, received array'],
    ['/portfolio/extract', JSON.stringify({ image: { dataBase64: 42 } }), 'image.dataBase64: Invalid input: expected string'],
    ['/dev/import', JSON.stringify({ configName: 'x', uploads: 'nope' }), 'uploads: Invalid input: expected array'],
    ['/dev/databases/activate', JSON.stringify({ synthetic: 'yes' }), 'synthetic: Invalid input: expected boolean'],
  ] as const;

  it('answers a malformed body on every POST route with a 400 that names the field', async () => {
    const on = buildApp({ store, logger: false, devTools: true });
    for (const [url, payload, message] of malformed) {
      const res = await on.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload });
      expect(res.statusCode, url).toBe(400);
      expect(Object.keys(res.json<object>()), url).toEqual(['error']);
      expect(res.json<{ error: string }>().error, url).toContain(message);
    }
  });

  it('still answers a body-less /backtest with the default strategy, as before the schema', async () => {
    // A POST with no content type has no body at all; `app.ts` turns that into
    // `{}` before validation, which is the tolerance the routes used to spell
    // `request.body ?? {}`. The stream itself is covered in fanBacktest.test.ts.
    const res = await app().inject({ method: 'POST', url: '/backtest' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('ndjson');
  });

  it('treats a literal JSON null body as an empty object, as `request.body ?? {}` did', async () => {
    const a = app();
    const backtest = await a.inject({ method: 'POST', url: '/backtest', headers: { 'content-type': 'application/json' }, payload: 'null' });
    expect(backtest.statusCode).toBe(200);
    expect(backtest.headers['content-type']).toContain('ndjson');
    // /signals reaches its own wording for the missing strategy, not "expected object".
    const signals = await a.inject({ method: 'POST', url: '/signals', headers: { 'content-type': 'application/json' }, payload: 'null' });
    expect(signals.statusCode).toBe(400);
    expect(signals.json()).toEqual({ error: 'unknown or missing strategy' });
  });

  it('serialises the engine rows unchanged — the response schemas strip nothing', async () => {
    // The serialiser drops keys a schema does not name. Comparing against the
    // handler's own result, round-tripped through JSON, is the check that the
    // schemas name every key the engine emits (and that NaN still goes as null).
    const a = app();
    const screen = (await a.inject({ method: 'POST', url: '/screen' })).json<ScreenResponse>();
    const direct = JSON.parse(JSON.stringify(handleScreen(store.get()))) as ScreenResponse;
    expect(screen.matches).toEqual(direct.matches);
    expect(screen.near).toEqual(direct.near);

    const signals = (await a.inject({ method: 'POST', url: '/signals', ...json({ strategy: 'tag50' }) })).json<SignalsResponse>();
    const directSignals = JSON.parse(JSON.stringify(
      handleSignals(store.get(), parseFanSignalsBody({ strategy: 'tag50' })),
    )) as SignalsResponse;
    expect(signals.rows).toEqual(directSignals.rows);
  });

  it('serialises a non-finite engine number as null, as JSON.stringify always did', async () => {
    const nanStore: UniverseStore = {
      ...store,
      getInstrument: () => ({ ticker: 'X', name: 'X', sector: 'S', bars: [{ o: 1, h: 1, l: 1, c: 1, v: NaN }] }),
    };
    const res = await buildApp({ store: nanStore, logger: false, devTools: false })
      .inject({ method: 'GET', url: '/instrument/X' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ bars: { v: unknown }[] }>().bars[0].v).toBeNull();
  });

  it('catches a response that violates its schema as a logged 500, not a different payload', async () => {
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) { lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>); cb(); },
    });
    const wrongStore: UniverseStore = {
      ...store,
      // A price as a string is the kind of drift a provider change produces.
      getInstrument: () => ({ ticker: 'X', name: 'X', sector: 'S', bars: [{ o: '1', h: 1, l: 1, c: 1, v: 1 }] }) as never,
    };
    const res = await buildApp({ store: wrongStore, devTools: false, logger: pino({ level: 'info' }, sink) })
      .inject({ method: 'GET', url: '/instrument/X' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal error' });
    const failure = lines.find((l) => l.msg === 'request failed');
    expect((failure?.err as { code?: string } | undefined)?.code).toBe('FST_ERR_RESPONSE_SERIALIZATION');
  });

  it('publishes an OpenAPI document listing every route the instance registered', async () => {
    const expected = [
      '/health', '/metrics', '/facts', '/screen', '/signals', '/backtest', '/instrument/{ticker}',
      '/portfolio/status', '/portfolio/extract',
    ];
    const dev = ['/dev/import/options', '/dev/import', '/dev/databases', '/dev/databases/activate'];

    const off = await app().inject({ method: 'GET', url: '/docs/json' });
    expect(off.statusCode).toBe(200);
    const doc = off.json<{ openapi: string; paths: Record<string, object> }>();
    expect(doc.openapi).toMatch(/^3\.1/);
    // Exactly these: the UI's own routes are hidden, and the /dev/* plugin is
    // not registered, so it is not documented either.
    expect(Object.keys(doc.paths).sort()).toEqual([...expected].sort());

    const on = await buildApp({ store, logger: false, devTools: true }).inject({ method: 'GET', url: '/docs/json' });
    expect(Object.keys(on.json<{ paths: object }>().paths).sort()).toEqual([...expected, ...dev].sort());
  });

  it('serves the docs UI at /docs as GETs, leaving the JSON-only POST rule intact', async () => {
    const a = app();
    const page = await a.inject({ method: 'GET', url: '/docs' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const asset = await a.inject({ method: 'GET', url: '/docs/static/swagger-ui-bundle.js' });
    expect(asset.statusCode).toBe(200);
    // Registering the UI added no content-type parser: a form post still stops at 415.
    const form = await a.inject({ method: 'POST', url: '/signals', headers: { 'content-type': 'text/plain' }, payload: 'x' });
    expect(form.statusCode).toBe(415);
  });
});
