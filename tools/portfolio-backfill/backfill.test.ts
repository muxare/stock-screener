// backfill.test.ts — a batch's whole life, without the hour it takes.
//
// The port is scripted, so these run in milliseconds and cost nothing. What they
// are really guarding is the one mistake this tool could make silently: reading
// results positionally. The API returns them in whatever order they finished,
// and a backfill that files one month's holdings under another month's date
// produces a plausible, wrong history that nobody would notice.

import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { buildRequests, customIdFor, runBackfill, isImageMediaType } from './backfill.ts';
import type { BatchItem, BatchPort } from './backfill.ts';
import type { Extraction } from '../../server/claude/portfolio/schema.ts';
import type { BarLookup } from '../../server/claude/portfolio/validate.ts';

const NO_BARS: BarLookup = { getInstrument: () => null };

const items: BatchItem[] = [
  { customId: '2026-01.png', mediaType: 'image/png', dataBase64: 'aGVsbG8=' },
  { customId: '2026-02.png', mediaType: 'image/png', dataBase64: 'aGVsbG8y' },
];

const extraction = (name: string, shares: number | null = 10): Extraction => ({
  accountLabel: 'ISK',
  holdings: [{
    ticker: 'AAPL', name, shares, averagePrice: 150, lastPrice: null,
    marketValue: null, currency: 'USD', valueCurrency: null, confidence: 'high', note: null,
  }],
  warnings: [],
});

type Response = Anthropic.Messages.Batches.MessageBatchIndividualResponse;

/** The API echoes the id it was *sent*, so the fakes below must do the same. */
const ID = (index: number) => customIdFor(items[index].customId, index);

const succeeded = (customId: string, body: Extraction): Response => ({
  custom_id: customId,
  result: {
    type: 'succeeded',
    message: { content: [{ type: 'text', text: JSON.stringify(body), citations: null }] },
  },
} as unknown as Response);

const errored = (customId: string, type: string): Response => ({
  custom_id: customId,
  result: { type: 'errored', error: { type } },
} as unknown as Response);

function port(responses: Response[], statuses: string[] = ['ended']): BatchPort & { submitted: number } {
  const queue = [...statuses];
  const state = {
    submitted: 0,
    async create(requests: Anthropic.Messages.Batches.BatchCreateParams.Request[]) {
      state.submitted = requests.length;
      return 'batch_test';
    },
    async status() { return queue.length > 1 ? (queue.shift() as string) : queue[0]; },
    results() {
      return { async *[Symbol.asyncIterator]() { for (const r of responses) yield r; } };
    },
  };
  return state;
}

describe('buildRequests', () => {
  it('sends the live route model, prompt and schema, one request per screenshot', () => {
    const requests = buildRequests(items);
    expect(requests).toHaveLength(2);
    // The API constrains custom_id to ^[a-zA-Z0-9_-]{1,64}$; a file name is not
    // one, and asserting the file name here is what let a 400 reach a real run.
    for (const request of requests) {
      expect(request.custom_id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
    expect(requests[0].custom_id).toBe('0-2026-01_png');
    expect(requests[0].params.model).toBe('claude-opus-5');
    expect(requests[0].params.system).toContain('GAV');
    expect(requests[0].params.output_config?.format).toBeTruthy();
    const content = requests[0].params.messages[0].content as { type: string }[];
    expect(content[0].type).toBe('image');
  });
});

describe('runBackfill', () => {
  it('keys results by custom_id, not by the order they came back in', async () => {
    const out = await runBackfill(
      items,
      // Deliberately reversed: the second screenshot finished first.
      port([succeeded(ID(1), extraction('February')), succeeded(ID(0), extraction('January'))]),
      NO_BARS,
    );
    expect(out.outcomes.map((o) => o.customId)).toEqual(['2026-01.png', '2026-02.png']);
    expect(out.outcomes[0].extraction?.holdings[0].name).toBe('January');
    expect(out.outcomes[1].extraction?.holdings[0].name).toBe('February');
    expect(out.succeeded).toBe(2);
  });

  it('runs the same meaning checks as the live route, and does not retry', async () => {
    const out = await runBackfill(
      [items[0]],
      port([succeeded(ID(0), extraction('January', -5))]),
      NO_BARS,
    );
    expect(out.succeeded).toBe(0);
    expect(out.outcomes[0].ok).toBe(false);
    expect(out.outcomes[0].problems[0]).toContain('impossible');
    // The rows still come back for the operator to look at.
    expect(out.outcomes[0].extraction).not.toBeNull();
  });

  it('reports a rejected item rather than losing it', async () => {
    const out = await runBackfill([items[0]], port([errored(ID(0), 'invalid_request')]), NO_BARS);
    expect(out.outcomes[0].failure).toContain('invalid_request');
    expect(out.failed).toBe(1);
  });

  it('accounts for an item the batch never answered for', async () => {
    const out = await runBackfill(items, port([succeeded(ID(0), extraction('January'))]), NO_BARS);
    expect(out.outcomes[1].failure).toContain('no result');
    expect(out.failed).toBe(1);
  });

  it('waits while the batch is still processing', async () => {
    const waits: number[] = [];
    const out = await runBackfill(
      [items[0]],
      port([succeeded(ID(0), extraction('January'))], ['in_progress', 'in_progress', 'ended']),
      NO_BARS,
      { pollMs: 5, sleep: async (ms) => { waits.push(ms); } },
    );
    expect(waits).toEqual([5, 5]);
    expect(out.succeeded).toBe(1);
  });

  it('gives up rather than polling forever, and says how to pick the batch up later', async () => {
    await expect(runBackfill(
      [items[0]],
      port([], ['in_progress']),
      NO_BARS,
      { pollMs: 1, maxPolls: 3, sleep: async () => {} },
    )).rejects.toThrow(/retrieve it by id later/);
  });

  it('refuses two screenshots with the same name, which would collide as custom ids', async () => {
    await expect(runBackfill(
      [items[0], { ...items[1], customId: items[0].customId }],
      port([]),
      NO_BARS,
    )).rejects.toThrow(/share the name/);
  });

  it('refuses an empty folder rather than submitting an empty batch', async () => {
    await expect(runBackfill([], port([]), NO_BARS)).rejects.toThrow(/nothing to submit/);
  });
});

describe('customIdFor', () => {
  it('cleans a file name into something the API accepts, and keeps it unique', () => {
    expect(customIdFor('2026-01.png', 0)).toBe('0-2026-01_png');
    expect(customIdFor('skärmavbild (1).png', 3)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    // Two names that clean to the same string still get different ids, or one
    // screenshot's result would be filed under the other's name.
    expect(customIdFor('a b.png', 0)).not.toBe(customIdFor('a-b.png', 1));
    expect(customIdFor('x'.repeat(200), 7).length).toBeLessThanOrEqual(64);
  });
});

describe('isImageMediaType', () => {
  it('admits what the Messages API takes and nothing else', () => {
    expect(isImageMediaType('image/png')).toBe(true);
    expect(isImageMediaType('image/bmp')).toBe(false);
  });
});
