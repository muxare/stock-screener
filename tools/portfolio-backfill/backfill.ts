// backfill.ts — a folder of screenshots through the Message Batches API.
//
// Phase C of `docs/cca-f-learning-plan.md` asks for the batch path to be built
// for real rather than described, and the case for it here is not hypothetical:
// a year of monthly account screenshots is fifty-odd images, none of them
// urgent, and each one is a request identical in shape to the interactive one.
// That is precisely the workload the Batches API exists for — half the price, no
// interactive deadline, and results that arrive within the hour.
//
// **Same prompt, same schema, same validation as the live route.** The whole
// point would be lost if the batch path drifted into being a second, slightly
// different extractor: phase D's eval measures one prompt, and a backfilled
// holding must be exactly as trustworthy as an interactively read one. So this
// file imports `SYSTEM_PROMPT`, `ExtractionSchema` and `validateExtraction` from
// `server/claude/` rather than restating any of them.
//
// Two things genuinely differ from the live path, both consequences of there
// being nobody watching:
//
//   - **There is no retry.** The interactive route repairs a failed validation
//     in a second turn because a user is waiting and a repair is cheaper than a
//     failure they have to look at. A batch item that fails validation is simply
//     reported as failed with its problems: re-running it is a new batch, which
//     costs nothing but time, and a half-hour round trip to repair one row is a
//     worse trade than telling the operator which file to look at.
//   - **Nothing is confirmed.** The results are written as files for a human to
//     review. Stage 5 of `docs/platform-hardening-plan.md` is where a confirmed
//     holding gets a durable home; until it exists there is nowhere for this
//     tool to write that would not be a second, unreviewed source of truth.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { MODEL, MAX_TOKENS } from '../../server/claude/client.ts';
import { SYSTEM_PROMPT, USER_PROMPT } from '../../server/claude/portfolio/prompt.ts';
import { ExtractionSchema } from '../../server/claude/portfolio/schema.ts';
import type { Extraction } from '../../server/claude/portfolio/schema.ts';
import { validateExtraction } from '../../server/claude/portfolio/validate.ts';
import type { BarLookup } from '../../server/claude/portfolio/validate.ts';
import { IMAGE_MEDIA_TYPES } from '../../server/claude/portfolio/extract.ts';
import type { ImageMediaType } from '../../server/claude/portfolio/extract.ts';

/** One screenshot, named by the file it came from. */
export interface BatchItem {
  /** The file's base name. Becomes the `custom_id`, so it must be unique. */
  customId: string;
  mediaType: ImageMediaType;
  dataBase64: string;
}

/** What one item produced. `ok` means it parsed *and* passed the checks. */
export interface ItemOutcome {
  customId: string;
  ok: boolean;
  extraction: Extraction | null;
  problems: string[];
  /** Set when the item never produced an answer at all. */
  failure: string | null;
}

export interface BackfillReport {
  batchId: string;
  submitted: number;
  succeeded: number;
  failed: number;
  outcomes: ItemOutcome[];
}

/**
 * The slice of the Batches API this tool uses.
 *
 * Injectable for the same reason the live path's caller is: the tests script a
 * batch's whole life — submitted, in progress, ended, results — without a key,
 * a network or the hour a real batch takes.
 */
export interface BatchPort {
  create(requests: Anthropic.Messages.Batches.BatchCreateParams.Request[]): Promise<string>;
  /** `ended` stops the poll; anything else means keep waiting. */
  status(batchId: string): Promise<string>;
  results(batchId: string): AsyncIterable<Anthropic.Messages.Batches.MessageBatchIndividualResponse>;
}

export function apiBatchPort(client: Anthropic): BatchPort {
  return {
    async create(requests) {
      const batch = await client.messages.batches.create({ requests });
      return batch.id;
    },
    async status(batchId) {
      const batch = await client.messages.batches.retrieve(batchId);
      return batch.processing_status;
    },
    results(batchId) {
      // The SDK returns a promise of an async iterable; unwrapping it here keeps
      // `for await` at the call site straightforward.
      return {
        async *[Symbol.asyncIterator]() {
          for await (const item of await client.messages.batches.results(batchId)) yield item;
        },
      };
    },
  };
}

export function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * The `custom_id` the API will accept for the item at `index`.
 *
 * The API constrains it to `^[a-zA-Z0-9_-]{1,64}$`, which a file name is not:
 * `2026-01.png` contains a dot and is rejected outright with a 400. Found on the
 * first real run, 2026-09-21, because the scripted port in the tests accepted
 * whatever it was given — a fake that is more permissive than the thing it
 * stands in for tests the author's assumption instead of the API's rule.
 *
 * The index prefix is what guarantees uniqueness: two different names can clean
 * to the same string, and a duplicate `custom_id` would silently pair one
 * screenshot's result with another's. Results are mapped back to file names by
 * the same function, so the JSON a reader opens is still named for the image.
 */
export function customIdFor(name: string, index: number): string {
  return `${index}-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);
}

/** One batch request per screenshot, in the live route's exact shape. */
export function buildRequests(items: readonly BatchItem[]): Anthropic.Messages.Batches.BatchCreateParams.Request[] {
  return items.map((item, index) => ({
    custom_id: customIdFor(item.customId, index),
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(ExtractionSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: item.mediaType, data: item.dataBase64 } },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    },
  }));
}

/** The first text block of an assistant turn, which is where the JSON is. */
function textOf(content: Anthropic.ContentBlock[]): string | null {
  for (const block of content) if (block.type === 'text') return block.text;
  return null;
}

function outcomeOf(
  item: Anthropic.Messages.Batches.MessageBatchIndividualResponse,
  bars: BarLookup,
): ItemOutcome {
  const base = { customId: item.custom_id, extraction: null, problems: [] as string[] };
  switch (item.result.type) {
    case 'succeeded': {
      const text = textOf(item.result.message.content);
      if (text === null) return { ...base, ok: false, failure: 'the answer carried no text block' };
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return { ...base, ok: false, failure: 'the answer was not valid JSON' };
      }
      const parsed = ExtractionSchema.safeParse(raw);
      if (!parsed.success) return { ...base, ok: false, failure: 'the answer did not fit the schema' };
      const problems = validateExtraction(parsed.data, bars);
      return { customId: item.custom_id, ok: problems.length === 0, extraction: parsed.data, problems, failure: null };
    }
    case 'errored':
      // `invalid_request` is ours to fix and will fail identically on a re-run;
      // anything else is worth resubmitting. The distinction is reported rather
      // than acted on, because acting on it is the operator's decision.
      return { ...base, ok: false, failure: `the API rejected the request (${item.result.error.type})` };
    case 'canceled':
      return { ...base, ok: false, failure: 'the batch was cancelled before this item ran' };
    default:
      return { ...base, ok: false, failure: 'the item expired before it ran — resubmit it' };
  }
}

export interface RunOptions {
  /** How long to wait between status checks. A real batch takes minutes. */
  pollMs?: number;
  /** Give up after this many checks rather than polling forever. */
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (message: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Submit every item as one batch, wait for it, and report each item's outcome.
 *
 * Results are keyed by `custom_id` and never by position: the API returns them
 * in whatever order they finished, and reading them positionally is how a
 * backfill silently files one account's holdings under another's date.
 */
export async function runBackfill(
  items: readonly BatchItem[],
  port: BatchPort,
  bars: BarLookup,
  options: RunOptions = {},
): Promise<BackfillReport> {
  const { pollMs = 30_000, maxPolls = 240, sleep = defaultSleep, onProgress = () => {} } = options;
  if (items.length === 0) throw new Error('nothing to submit: no screenshots were found');

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.customId)) throw new Error(`two screenshots share the name "${item.customId}"`);
    seen.add(item.customId);
  }

  const batchId = await port.create(buildRequests(items));
  onProgress(`submitted ${items.length} screenshot(s) as batch ${batchId}`);

  let polls = 0;
  for (;;) {
    const status = await port.status(batchId);
    if (status === 'ended') break;
    polls += 1;
    if (polls >= maxPolls) {
      throw new Error(`batch ${batchId} was still ${status} after ${polls} checks — retrieve it by id later`);
    }
    onProgress(`batch ${batchId} is ${status}; checking again in ${Math.round(pollMs / 1000)}s`);
    await sleep(pollMs);
  }

  // Back from the API's ids to the file names the operator will recognise.
  const fileNameById = new Map(items.map((item, index) => [customIdFor(item.customId, index), item.customId]));

  const byId = new Map<string, ItemOutcome>();
  for await (const item of port.results(batchId)) {
    const outcome = outcomeOf(item, bars);
    const fileName = fileNameById.get(item.custom_id) ?? item.custom_id;
    byId.set(fileName, { ...outcome, customId: fileName });
  }

  const outcomes = items.map(
    (item) =>
      byId.get(item.customId) ?? {
        customId: item.customId,
        ok: false,
        extraction: null,
        problems: [],
        failure: 'the batch returned no result for this item',
      },
  );

  return {
    batchId,
    submitted: items.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
  };
}
