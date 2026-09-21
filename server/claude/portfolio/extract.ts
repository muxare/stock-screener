// claude/portfolio/extract.ts — one screenshot in, a proposal out.
//
// The CCA-F surface decision, applied rather than restated: this is extraction,
// the task is fully specifiable in advance, and there is nothing for a tool to
// do. So it is a **single API call** — not a workflow, and certainly not an
// agent. The only loop here is the validation-retry loop, which is control flow
// this file owns and not an agent deciding what to do next.
//
// The retry is bounded at two attempts, hard. A model that has misread a digit
// twice with the failure spelled out is not going to read it correctly on the
// fifth attempt, and each attempt re-sends the image at full price. What the
// second attempt cannot fix is reported alongside the rows rather than thrown
// away — see `problems` below.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { MODEL, MAX_TOKENS, anthropic } from '../client.ts';
import { toClaudeError, ClaudeError } from '../errors.ts';
import { SYSTEM_PROMPT, USER_PROMPT, repairPrompt } from './prompt.ts';
import { ExtractionSchema } from './schema.ts';
import type { Extraction } from './schema.ts';
import { validateExtraction } from './validate.ts';
import type { BarLookup } from './validate.ts';

/** What the Messages API will accept as an image block. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export interface ScreenshotImage {
  mediaType: ImageMediaType;
  /** Base64, without a data-URL prefix. Never logged, never echoed back. */
  dataBase64: string;
}

/**
 * One model turn, as this module needs it.
 *
 * The SDK is reached through this port rather than directly so the retry loop
 * can be tested without a key, a network or a cent — the tests supply a caller
 * that returns a scripted answer. It also keeps every SDK type at one boundary,
 * which is the seam phase D's eval runner and the batch backfill both reuse.
 */
export interface ExtractionCaller {
  (messages: Anthropic.MessageParam[]): Promise<CallerResult>;
}

export interface CallerResult {
  /** The parsed answer, or null when it did not satisfy the schema. */
  parsed: Extraction | null;
  /** The assistant turn verbatim, to be echoed back on a repair attempt. */
  content: Anthropic.ContentBlock[];
}

export interface PortfolioExtraction {
  extraction: Extraction;
  /** 1 or 2. Recorded because a silent retry is a cost and a quality signal. */
  attempts: number;
  /**
   * Meaning checks that were still failing when the attempts ran out. Empty on
   * a clean extraction.
   *
   * Phase C's plan text said to "surface the failure to the user" here, and this
   * is that — deliberately as data beside the rows rather than as a thrown
   * error. Discarding eleven good rows because the twelfth has a market value
   * that does not multiply out would be a worse answer than showing all twelve
   * with the twelfth flagged, and the rows were never a fact to begin with: the
   * user confirms every one of them before anything is stored.
   */
  problems: string[];
}

/** The production caller: a real API request per turn. */
export function apiCaller(client: Anthropic = anthropic()): ExtractionCaller {
  return async (messages) => {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Reading a compressed broker table repays looking twice, and on this
      // model thinking is on by default anyway — saying so explicitly keeps the
      // setting visible next to the reason for it. `budget_tokens` is removed on
      // Opus 5 and sending it would be a 400.
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages,
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });
    return { parsed: response.parsed_output ?? null, content: response.content };
  };
}

function firstTurn(image: ScreenshotImage): Anthropic.MessageParam[] {
  return [
    {
      role: 'user',
      content: [
        // The image goes before the text: a question asked after the evidence
        // reads better to the model, and it keeps the (large, stable) image
        // block at the front of the turn.
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.dataBase64 } },
        { type: 'text', text: USER_PROMPT },
      ],
    },
  ];
}

/**
 * Extract the holdings from one screenshot.
 *
 * Throws a `ClaudeError` when there is nothing to show the user: no key
 * configured, the API refused, or neither attempt produced an answer that fit
 * the schema. A parseable answer always comes back, even when it still has
 * problems attached.
 */
export async function extractPortfolio(
  image: ScreenshotImage,
  bars: BarLookup,
  caller: ExtractionCaller = apiCaller(),
): Promise<PortfolioExtraction> {
  const messages = firstTurn(image);
  let attempts = 0;
  let lastParsed: Extraction | null = null;
  let problems: string[] = [];

  // Two attempts, never more. The second exists to repair a specific stated
  // failure; there is no third because there is no new information to give it.
  while (attempts < 2) {
    attempts += 1;
    let result: CallerResult;
    try {
      result = await caller(messages);
    } catch (err) {
      throw toClaudeError(err);
    }

    if (result.parsed) {
      lastParsed = result.parsed;
      problems = validateExtraction(result.parsed, bars);
      if (problems.length === 0) return { extraction: result.parsed, attempts, problems };
    } else {
      // Structured outputs make this rare rather than impossible: a response cut
      // off at max_tokens leaves valid-shaped JSON unfinished, and that arrives
      // here as a parse failure with nothing to repair from.
      problems = ['the answer did not fit the required schema'];
    }

    if (attempts >= 2) break;
    messages.push({ role: 'assistant', content: result.content });
    messages.push({ role: 'user', content: repairPrompt(problems) });
  }

  if (!lastParsed) {
    throw new ClaudeError(
      'extraction_failed',
      'the model did not return a usable holdings table after two attempts',
    );
  }
  return { extraction: lastParsed, attempts, problems };
}
