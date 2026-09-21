// portfolio.test.ts — the route around the screenshot reader.
//
// Every case drives the real application through `app.inject()` with a scripted
// caller, so the routing, the JSON parser, the error handler and this route's
// own boundary checks all run — and not one of them reaches the API. The one
// test that must not be written here is a live extraction: it would cost money,
// need a key, and assert on a model's reading of a fixture. That belongs to
// phase D's eval, which is opt-in for exactly those reasons.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from './app.ts';
import { createUniverseStore } from './universe.ts';
import { syntheticProvider } from '../src/lib/data/synthetic.ts';
import { loadConfig } from './config.ts';
import { anthropic, resetAnthropic, MODEL } from './claude/client.ts';
import { ClaudeError } from './claude/errors.ts';
import type { CallerResult, ExtractionCaller } from './claude/portfolio/extract.ts';
import type { Extraction } from './claude/portfolio/schema.ts';

const store = createUniverseStore(syntheticProvider(7));
beforeAll(() => { store.get(); });

const EXTRACTION: Extraction = {
  accountLabel: 'ISK',
  holdings: [
    { ticker: null, name: 'Volvo B', shares: 120, averagePrice: 241.5, lastPrice: 250, marketValue: 30000, currency: 'SEK', valueCurrency: 'SEK', confidence: 'high', note: null },
    { ticker: null, name: 'Investor B', shares: null, averagePrice: null, lastPrice: null, marketValue: null, currency: null, valueCurrency: null, confidence: 'low', note: 'the row is cut off at the bottom edge' },
  ],
  warnings: ['the table continues below the visible area'],
};

const answering = (extraction: Extraction | null): ExtractionCaller =>
  async (): Promise<CallerResult> => ({ parsed: extraction, content: [{ type: 'text', text: '{}', citations: null }] });

const failing = (err: unknown): ExtractionCaller => async () => { throw err; };

const app = (portfolioCaller?: ExtractionCaller) =>
  buildApp({ store, logger: false, devTools: false, portfolioCaller });

const post = (payload: unknown) => ({
  method: 'POST' as const,
  url: '/portfolio/extract',
  headers: { 'content-type': 'application/json' },
  payload: JSON.stringify(payload),
});

const png = (data = 'aGVsbG8=') => ({ image: { mediaType: 'image/png', dataBase64: data } });

describe('GET /portfolio/status', () => {
  it('reports whether the feature is wired up in this environment', async () => {
    const res = await app().inject({ method: 'GET', url: '/portfolio/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ available: boolean; model: string }>();
    expect(typeof body.available).toBe('boolean');
    expect(body.model).toBe(MODEL);
  });
});

describe('POST /portfolio/extract', () => {
  it('returns the extraction, the attempt count and the unresolved problems', async () => {
    const res = await app(answering(EXTRACTION)).inject(post(png()));
    expect(res.statusCode).toBe(200);
    const body = res.json<{ extraction: Extraction; attempts: number; problems: string[] }>();
    expect(body.attempts).toBe(1);
    expect(body.problems).toEqual([]);
    expect(body.extraction.holdings).toHaveLength(2);
    // The unreadable row came back as nulls with a note, not as numbers.
    expect(body.extraction.holdings[1].shares).toBeNull();
    expect(body.extraction.holdings[1].confidence).toBe('low');
  });

  it('accepts what a browser FileReader actually produces — a data URL', async () => {
    const res = await app(answering(EXTRACTION)).inject(post({
      image: { dataBase64: 'data:image/jpeg;base64,aGVsbG8=' },
    }));
    expect(res.statusCode).toBe(200);
  });

  it('refuses a body with no image', async () => {
    const res = await app(answering(EXTRACTION)).inject(post({}));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('image');
  });

  it('refuses a media type the Messages API will not take', async () => {
    const res = await app(answering(EXTRACTION)).inject(post({
      image: { mediaType: 'image/bmp', dataBase64: 'aGVsbG8=' },
    }));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('image/png');
  });

  it('refuses an image too large to send, before paying to have it refused upstream', async () => {
    const res = await app(answering(EXTRACTION)).inject(post(png('A'.repeat((6 << 20) + 1))));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('too large');
  });

  it('answers a missing key with 503 and a category, not a 500', async () => {
    const res = await app(failing(new ClaudeError('not_configured', 'no key here'))).inject(post(png()));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: 'no key here',
      errorCategory: 'not_configured',
      isRetryable: false,
    });
  });

  it('tells the caller whether trying again could help', async () => {
    const res = await app(answering(null)).inject(post(png()));
    expect(res.statusCode).toBe(422);
    const body = res.json<{ errorCategory: string; isRetryable: boolean }>();
    expect(body.errorCategory).toBe('extraction_failed');
    expect(body.isRetryable).toBe(true);
  });
});

describe('the client', () => {
  it('refuses to construct without a key, and says which variable is missing', () => {
    resetAnthropic();
    const keyless = loadConfig({ NODE_ENV: 'test' });
    expect(() => anthropic(keyless)).toThrowError(/ANTHROPIC_API_KEY/);
    try {
      anthropic(keyless);
    } catch (err) {
      expect((err as ClaudeError).category).toBe('not_configured');
      expect((err as ClaudeError).status).toBe(503);
    }
  });

  it('does not echo the key it was given', () => {
    resetAnthropic();
    const cfg = loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'sk-ant-notarealkey' });
    const client = anthropic(cfg);
    expect(JSON.stringify(cfg)).not.toContain('notarealkey');
    // The same config gets the same memoised client rather than a new one.
    expect(anthropic(cfg)).toBe(client);
    resetAnthropic();
  });
});
