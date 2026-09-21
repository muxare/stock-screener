// extract.test.ts — the meaning checks and the two-attempt retry loop.
//
// No key, no network and no cost: `extractPortfolio` takes its caller as a
// parameter, so every case here scripts what the model "answered" and asserts
// what the loop did about it. That seam is the whole reason the SDK is reached
// through a one-function port rather than called from the middle of the loop.

import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { extractPortfolio } from './extract.ts';
import type { CallerResult } from './extract.ts';
import { validateExtraction } from './validate.ts';
import type { BarLookup } from './validate.ts';
import type { Extraction, Holding } from './schema.ts';
import { toClaudeError, ClaudeError } from '../errors.ts';

const IMAGE = { mediaType: 'image/png' as const, dataBase64: 'aGVsbG8=' };

const holding = (over: Partial<Holding> = {}): Holding => ({
  ticker: 'AAPL',
  name: 'Apple Inc',
  shares: 10,
  averagePrice: 150,
  lastPrice: 200,
  marketValue: 2000,
  currency: 'USD',
  valueCurrency: 'USD',
  confidence: 'high',
  note: null,
  ...over,
});

const extraction = (holdings: Holding[]): Extraction => ({
  accountLabel: 'ISK',
  holdings,
  warnings: [],
});

// A universe that knows one ticker, which has traded between 90 and 220.
const bars: BarLookup = {
  getInstrument: (ticker) =>
    ticker === 'AAPL'
      ? {
          ticker: 'AAPL',
          name: 'Apple Inc',
          sector: 'Tech',
          bars: [
            { o: 100, h: 220, l: 90, c: 210, v: 1000 },
            { o: 210, h: 215, l: 195, c: 200, v: 900 },
          ],
        }
      : null,
};

/** A caller that answers with each scripted extraction in turn. */
function scripted(...answers: (Extraction | null)[]) {
  const seen: number[] = [];
  const caller = async (messages: Anthropic.MessageParam[]): Promise<CallerResult> => {
    seen.push(messages.length);
    const next = answers.shift() ?? null;
    return { parsed: next, content: [{ type: 'text', text: '{}', citations: null }] };
  };
  return { caller, seen };
}

describe('validateExtraction', () => {
  it('passes a row that is internally consistent and within the traded range', () => {
    expect(validateExtraction(extraction([holding()]), bars)).toEqual([]);
  });

  it('accepts nulls everywhere — an unreadable field is the correct answer', () => {
    const blank = holding({ shares: null, averagePrice: null, lastPrice: null, marketValue: null, confidence: 'low' });
    expect(validateExtraction(extraction([blank]), bars)).toEqual([]);
  });

  it('rejects a negative share count and names the row', () => {
    const problems = validateExtraction(extraction([holding({ shares: -10, marketValue: null })]), bars);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('row 1 (AAPL)');
    expect(problems[0]).toContain('impossible');
  });

  it('rejects a fractional share count', () => {
    const problems = validateExtraction(extraction([holding({ shares: 10.5, marketValue: null })]), bars);
    expect(problems[0]).toContain('not a whole number');
  });

  it('catches a misread digit through the printed market value', () => {
    // 100 x 200 is 20 000, not the 2 000 printed: the share count gained a zero.
    const problems = validateExtraction(extraction([holding({ shares: 100 })]), bars);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('market value');
  });

  it('does not compare a price in one currency with a value in another', () => {
    // The first real screenshot: an Avanza account prints Tesla's price in USD
    // and its value in kronor, so 3 x 375.86 against 11 097 is not a misread —
    // it is two currencies. Before this, the check called it one and spent a
    // second attempt proving itself wrong.
    const foreign = holding({ shares: 3, lastPrice: 375.86, marketValue: 11097, currency: 'USD', valueCurrency: 'SEK', averagePrice: null, ticker: null });
    expect(validateExtraction(extraction([foreign]), bars)).toEqual([]);
  });

  it('still checks a row whose currencies match, or that names none at all', () => {
    const matched = holding({ shares: 3, lastPrice: 375.86, marketValue: 11097, currency: 'USD', valueCurrency: 'USD', averagePrice: null, ticker: null });
    expect(validateExtraction(extraction([matched]), bars)).toHaveLength(1);
    // A single-currency account often prints no code anywhere. Giving up the
    // check there would cost more than the rare false positive it avoids.
    const silent = holding({ shares: 100, currency: null, valueCurrency: null });
    expect(validateExtraction(extraction([silent]), bars)).toHaveLength(1);
  });

  it('tolerates the ordinary drift between a printed value and shares x last price', () => {
    // 1% out — a rounded total struck a moment apart, not a misread.
    expect(validateExtraction(extraction([holding({ marketValue: 2020 })]), bars)).toEqual([]);
  });

  it('rejects an average price outside everything the instrument has traded at', () => {
    const problems = validateExtraction(extraction([holding({ averagePrice: 1570, marketValue: null })]), bars);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('outside everything AAPL has traded at');
  });

  it('leaves a holding the universe has never heard of unchecked rather than doubted', () => {
    const unknown = holding({ ticker: 'VOLV B', averagePrice: 1570, marketValue: null });
    expect(validateExtraction(extraction([unknown]), bars)).toEqual([]);
  });
});

describe('extractPortfolio', () => {
  it('returns after one attempt when the first answer checks out', async () => {
    const { caller, seen } = scripted(extraction([holding()]));
    const result = await extractPortfolio(IMAGE, bars, caller);
    expect(result.attempts).toBe(1);
    expect(result.problems).toEqual([]);
    expect(result.extraction.holdings).toHaveLength(1);
    expect(seen).toEqual([1]);
  });

  it('retries exactly once, carrying the failure into the second turn', async () => {
    const { caller, seen } = scripted(extraction([holding({ shares: -10, marketValue: null })]), extraction([holding()]));
    const result = await extractPortfolio(IMAGE, bars, caller);
    expect(result.attempts).toBe(2);
    expect(result.problems).toEqual([]);
    // The second turn carries the first question, the first answer and the
    // repair instruction — three messages, not a fresh conversation.
    expect(seen).toEqual([1, 3]);
  });

  it('never makes a third attempt, and reports what is still wrong beside the rows', async () => {
    const bad = extraction([holding({ shares: -10, marketValue: null })]);
    const { caller, seen } = scripted(bad, bad, extraction([holding()]));
    const result = await extractPortfolio(IMAGE, bars, caller);
    expect(result.attempts).toBe(2);
    expect(seen).toHaveLength(2);
    expect(result.problems).toHaveLength(1);
    // The rows still come back: they were always a proposal for the user to
    // confirm, and eleven good rows are not discarded because the twelfth is odd.
    expect(result.extraction.holdings).toHaveLength(1);
  });

  it('throws when neither attempt produced an answer that fits the schema', async () => {
    const { caller } = scripted(null, null);
    await expect(extractPortfolio(IMAGE, bars, caller)).rejects.toMatchObject({
      category: 'extraction_failed',
      isRetryable: true,
      status: 422,
    });
  });

  it('keeps a schema failure repairable — a parsed second answer still wins', async () => {
    const { caller } = scripted(null, extraction([holding()]));
    const result = await extractPortfolio(IMAGE, bars, caller);
    expect(result.attempts).toBe(2);
    expect(result.problems).toEqual([]);
  });

  it('maps an API failure to its category rather than letting it escape raw', async () => {
    const caller = async (): Promise<CallerResult> => {
      throw new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers());
    };
    await expect(extractPortfolio(IMAGE, bars, caller)).rejects.toMatchObject({
      category: 'rate_limited',
      isRetryable: true,
    });
  });
});

describe('toClaudeError', () => {
  it('reads the typed chain most specific first', () => {
    const cases: [unknown, string, boolean][] = [
      [new Anthropic.AuthenticationError(401, undefined, 'nope', new Headers()), 'auth', false],
      [new Anthropic.BadRequestError(400, undefined, 'nope', new Headers()), 'upstream', true],
      [new Anthropic.RateLimitError(429, undefined, 'nope', new Headers()), 'rate_limited', true],
      [new Anthropic.APIConnectionError({ message: 'offline' }), 'upstream', true],
      [new Error('something else'), 'upstream', true],
    ];
    for (const [err, category, retryable] of cases) {
      const mapped = toClaudeError(err);
      expect(mapped.category).toBe(category);
      expect(mapped.isRetryable).toBe(retryable);
    }
  });

  it('passes a ClaudeError through unchanged', () => {
    const original = new ClaudeError('not_configured', 'no key');
    expect(toClaudeError(original)).toBe(original);
  });

  it('never puts the cause into the message that reaches the wire', () => {
    const mapped = toClaudeError(new Anthropic.AuthenticationError(401, undefined, 'sk-ant-leaky', new Headers()));
    expect(mapped.toWire()).toEqual({
      error: 'the configured API key was rejected',
      errorCategory: 'auth',
      isRetryable: false,
    });
  });
});
