// claude/errors.ts — one typed failure shape for every Claude-backed feature.
//
// Two rules from stage 7 of `docs/platform-hardening-plan.md` meet here. The
// first is the typed error chain: the SDK raises distinct classes and the only
// correct way to tell a rate limit from a bad request is `instanceof`, most
// specific first — never a string match on a message that Anthropic owns and
// can reword. The second is that a caller needs to know whether trying again is
// worth anything, which the class alone does not say.
//
// So every failure leaves this layer as a `ClaudeError` carrying a category, a
// retryable flag and an HTTP status. That triple is deliberately the same shape
// phase E of `docs/cca-f-learning-plan.md` has to return from every MCP tool
// (`{ errorCategory, isRetryable, message }`), so the mapping written here is
// written once rather than twice.
//
// Nothing in this file may put a request body, an image or an extracted holding
// into a message. An error message is a log line, and a log line has left the
// machine.

import Anthropic from '@anthropic-ai/sdk';

export type ClaudeErrorCategory =
  /** No ANTHROPIC_API_KEY in this environment. The feature is not wired up. */
  | 'not_configured'
  /** The caller sent something this endpoint cannot work with. */
  | 'invalid_input'
  /** The key was rejected. Retrying with the same key cannot help. */
  | 'auth'
  /** A 429 or an overloaded upstream. The same request later may well work. */
  | 'rate_limited'
  /** The model answered, but the answer never satisfied the schema or the data. */
  | 'extraction_failed'
  /** Anything else from the API or the network. */
  | 'upstream';

interface CategoryTraits {
  readonly isRetryable: boolean;
  readonly status: number;
}

// `status` is what the HTTP route answers with; `isRetryable` is advice to the
// caller and is what an MCP tool or a batch runner branches on. They are not the
// same question: a 503 here is retryable, a 401 is not, and a 422 says the model
// tried twice and the result still made no sense.
const TRAITS: Record<ClaudeErrorCategory, CategoryTraits> = {
  not_configured: { isRetryable: false, status: 503 },
  invalid_input: { isRetryable: false, status: 400 },
  auth: { isRetryable: false, status: 502 },
  rate_limited: { isRetryable: true, status: 503 },
  extraction_failed: { isRetryable: true, status: 422 },
  upstream: { isRetryable: true, status: 502 },
};

export class ClaudeError extends Error {
  readonly category: ClaudeErrorCategory;
  readonly isRetryable: boolean;
  readonly status: number;

  constructor(category: ClaudeErrorCategory, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ClaudeError';
    this.category = category;
    this.isRetryable = TRAITS[category].isRetryable;
    this.status = TRAITS[category].status;
  }

  /** The body an HTTP route or an MCP tool returns. Never carries the cause. */
  toWire(): { error: string; errorCategory: ClaudeErrorCategory; isRetryable: boolean } {
    return { error: this.message, errorCategory: this.category, isRetryable: this.isRetryable };
  }
}

// The typed chain, most specific first. `BadRequestError` before
// `AuthenticationError` before `RateLimitError` before `APIError` is not
// stylistic: every one of them extends `APIError`, so a single `instanceof
// Anthropic.APIError` arm placed first would swallow all of them and answer
// "upstream, retry later" to a 400 that will fail identically forever.
export function toClaudeError(err: unknown): ClaudeError {
  if (err instanceof ClaudeError) return err;
  if (err instanceof Anthropic.BadRequestError) {
    // Ours, not the caller's: the request shape is built in this repository, so
    // a 400 from the API means our own schema or content blocks are wrong.
    return new ClaudeError('upstream', 'the request the service built was rejected by the API', { cause: err });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new ClaudeError('auth', 'the configured API key was rejected', { cause: err });
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new ClaudeError('auth', 'the configured API key may not use this model', { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ClaudeError('rate_limited', 'rate limited by the API — try again shortly', { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ClaudeError('upstream', 'could not reach the API', { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new ClaudeError('upstream', `the API returned an error (status ${err.status ?? 'unknown'})`, { cause: err });
  }
  return new ClaudeError('upstream', 'the extraction failed for an unexpected reason', { cause: err });
}
