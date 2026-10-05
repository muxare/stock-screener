// schemas/common.ts — the pieces every route's schema is built from (hardening 2.2).
//
// Everything under `server/schemas/` imports `zod` and engine *types* and nothing
// else. That is a rule, not a habit: `src/lib/client/marketClient.ts` takes its
// request and response types from these files with `import type`, so the browser
// program type-checks them too, and a value import of anything Node-only here
// would put it in front of the browser's compiler. Validation helpers that need
// the service (`RequestError`) live in `validate.ts`, which the client never
// imports.

import { z } from 'zod';

/**
 * A number as the engine produces it and as the wire carries it.
 *
 * The engine uses `NaN` for "not computable" — a snapshot over a history too
 * short for a 52-week high, an ATR with no highs and lows — and `JSON.stringify`
 * writes `NaN` and `±Infinity` as `null`. `z.number()` refuses all three, so a
 * plain number schema would turn a short history into a 500. This one accepts
 * any JS number, and tells the OpenAPI document the truth about the wire: a
 * number, or `null` where the engine had none.
 *
 * The inferred type stays `number` rather than `number | null`, because that is
 * the type the engine and the UI already share; making the UI handle `null`
 * explicitly is a change to the engine's types, not to the transport's.
 */
export const wireNumber = z
  .custom<number>((v) => typeof v === 'number', { message: 'expected a number' })
  .meta({ type: ['number', 'null'] });

/** The one error shape every route answers with: `{ "error": "<message>" }`. */
export const ErrorResponseSchema = z
  .object({ error: z.string().describe('What went wrong, written for the caller.') })
  .meta({ id: 'Error' });

export type ErrorResponse = z.output<typeof ErrorResponseSchema>;

/**
 * The error responses every route can produce, for the OpenAPI document and for
 * the type of `reply.code(4xx).send(...)`. 5xx is deliberately absent: the error
 * handler answers an internal failure with the same shape, and a 5xx schema
 * would only give the serialiser a second chance to fail inside the handler of
 * the first failure.
 */
export const errorResponses = {
  '4xx': ErrorResponseSchema,
} as const;
