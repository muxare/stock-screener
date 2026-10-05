// mcp/errors.ts — the one failure shape every MCP tool returns.
//
// Phase E of `docs/cca-f-learning-plan.md`: a tool that fails must tell the model
// two things a bare message does not — what kind of failure it was, and whether
// asking again is worth anything. So every failure leaves a tool as
// `{ errorCategory, isRetryable, message }`, inside an MCP tool result marked
// `isError: true`. A tool error is a result the model reads and reasons about; a
// protocol error is something the client swallows, and the model never learns
// why its call did nothing.
//
// The four categories and their retry flags are fixed by the plan:
//
//   - `invalid_input`  — the arguments were wrong. The same call fails the same
//     way, so it is not retryable; the message says what to change.
//   - `unknown_ticker` — the ticker is not in the dataset. Not retryable either;
//     a different spelling is a different call.
//   - `universe_cold`  — the dataset could not be read just now (a SQLite file
//     mid-import, a locked handle). Retryable: the same call later may work.
//   - `internal`       — our bug. Retryable *once*, because a transient fault
//     looks the same from outside; the message says not to loop.
//
// `RequestError` from `handlers.ts` is the HTTP service's 400 signal, and the
// handlers and parsers the tools reuse throw it for bad input, so it maps to
// `invalid_input` without the tools having to translate it themselves.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RequestError } from '../handlers.ts';

export type ToolErrorCategory = 'invalid_input' | 'unknown_ticker' | 'universe_cold' | 'internal';

export const RETRYABLE: Record<ToolErrorCategory, boolean> = {
  invalid_input: false,
  unknown_ticker: false,
  universe_cold: true,
  internal: true,
};

export interface ToolErrorBody {
  errorCategory: ToolErrorCategory;
  isRetryable: boolean;
  message: string;
}

/** A failure a tool raises on purpose, already categorised. */
export class ToolError extends Error {
  readonly category: ToolErrorCategory;
  constructor(category: ToolErrorCategory, message: string) {
    super(message);
    this.category = category;
  }
}

/**
 * The dataset behind the port could not be read. Raised by the guarded
 * provider in `datasets.ts`, so a failure *reading bars* is told apart from a
 * failure *computing on them* — the first is `universe_cold`, the second is ours.
 */
export class DatasetUnavailableError extends Error {}

const INTERNAL_MESSAGE =
  'the screener failed internally. Retry this call once; if it fails again, stop and report ' +
  'the failure rather than retrying.';

/** Map anything a tool threw to the structured body. Unknown errors become `internal`. */
export function toErrorBody(err: unknown): ToolErrorBody {
  if (err instanceof ToolError) {
    return { errorCategory: err.category, isRetryable: RETRYABLE[err.category], message: err.message };
  }
  if (err instanceof RequestError) {
    return { errorCategory: 'invalid_input', isRetryable: false, message: err.message };
  }
  if (err instanceof DatasetUnavailableError) {
    return {
      errorCategory: 'universe_cold',
      isRetryable: true,
      message: `the dataset could not be read just now (${err.message}); retry in a few seconds`,
    };
  }
  // The underlying message is deliberately not repeated: it is ours, not the
  // caller's, and the stderr log carries it with the stack.
  return { errorCategory: 'internal', isRetryable: true, message: INTERNAL_MESSAGE };
}

/**
 * The MCP result for a failure. The body goes out twice: as `structuredContent`
 * for clients that read it, and as JSON text, which is what a model is shown.
 */
export function errorResult(body: ToolErrorBody): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: { ...body },
  };
}
