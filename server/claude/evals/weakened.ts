// claude/evals/weakened.ts — the control condition.
//
// Phase D's Verify line says "a deliberately weakened prompt lowers the score".
// That sentence is only worth writing if it can be run, and it can only be run if
// the harness has something worse to compare against. This file is that something
// worse, plus the one seam needed to use it.
//
// Why a weak prompt is the right control rather than, say, a cheaper model: the
// claim being checked is that **the eval can tell prompts apart at all**. An eval
// whose score does not move when the prompt is gutted is measuring the fixtures,
// not the prompt, and every "the eval delta says this change helped" in a future
// diary entry would be worthless. Running this once, seeing the score fall, and
// recording by how much is what buys the right to trust the harness later.
//
// **The production prompt module is not touched, and not imported-and-edited
// either.** Phase C's design says the service, the batch path and the eval send
// the same bytes; a switch inside `prompt.ts` would put a test-only branch in the
// middle of the thing being measured, and the first person to read it would
// reasonably wonder which branch production takes. Instead the substitution
// happens at the last possible moment — on the request itself, through the client
// the production caller was already built to accept — so everything else about
// the call (model, max tokens, adaptive thinking, the schema, the retry loop, the
// user prompt, the repair prompt) is provably identical between the two runs.
// That is what makes the difference in score attributable to the system prompt.

import Anthropic from '@anthropic-ai/sdk';

/**
 * Everything `SYSTEM_PROMPT` does carefully, done carelessly.
 *
 * Written to fail in the specific ways phase C's prompt was written to prevent,
 * so the comparison says something:
 *
 *   - Adjectives instead of criteria ("be careful"), where the real prompt states
 *     a testable rule per field.
 *   - No null rule at all, and an instruction to fill everything in — which is
 *     what makes a model invent a plausible digit, and what the `all-null`
 *     fixture is there to catch.
 *   - Nothing about Swedish number formatting, so "1 234,50" is free to come back
 *     as 1.23450 or 123450.
 *   - One currency question instead of two, which is exactly the bug the first
 *     real screenshot found on 2026-09-21.
 *   - No instruction to exclude summary rows, and none to refuse a non-holdings
 *     image — so the `not-holdings` fixture has nothing telling the model to stop.
 *   - No instruction to treat the image as data, which is left out deliberately:
 *     the fixtures are synthetic and contain no injected text, so removing it
 *     costs nothing here and keeps the weakened prompt honest about being the
 *     *older, worse* draft rather than a differently-scoped one.
 */
export const WEAKENED_SYSTEM_PROMPT = `You look at screenshots of stock portfolios and report what is in them.

Read the table and fill in each position: the ticker, the name, how many shares, the average price, the last price, the market value and the currency. Be careful with the numbers and try to fill in every field. Give each row a confidence.

Return the positions in the requested format.`;

/**
 * The same client, answering with a different system prompt.
 *
 * Prototype delegation rather than a new `Anthropic` — the SDK instance owns an
 * auth header, a fetch implementation, retry and timeout policy and a connection
 * pool, and a second construction would be a second set of all of them that only
 * happened to be configured the same way today. Two own properties shadow the
 * originals and everything else, including anything the SDK adds later, keeps
 * working through the prototype chain.
 *
 * It rewrites `system` unconditionally, which is correct here because the only
 * caller is the eval and the eval sends exactly one kind of request. This is not
 * a general-purpose middleware and should not grow into one.
 */
export function withSystemPrompt(client: Anthropic, system: string): Anthropic {
  const messages = Object.create(client.messages) as Anthropic['messages'];
  messages.parse = ((params: Anthropic.MessageCreateParamsNonStreaming, options?: unknown) =>
    (client.messages.parse as (p: unknown, o?: unknown) => unknown)({ ...params, system }, options)) as typeof client.messages.parse;
  const patched = Object.create(client) as Anthropic;
  patched.messages = messages;
  return patched;
}
