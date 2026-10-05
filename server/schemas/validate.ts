// schemas/validate.ts — how a schema failure becomes the service's 400.
//
// Two callers need the same answer to "this body is the wrong shape": Fastify,
// validating a request before its handler runs, and code that parses a body
// itself — the MCP `scan_signals` tool goes through `parseFanSignalsBody`, which
// is how it accepts and refuses exactly what `/signals` does. Both use the error
// map below, so a malformed field reads the same whichever door it came in by.
//
// This module is service-side only: it imports `RequestError`, and the browser
// never imports it (see `common.ts`).

import { z } from 'zod';
import type { FastifySchemaCompiler } from 'fastify';
import { RequestError } from '../handlers.ts';

/**
 * Zod's default messages do not say which field they are about ("Invalid
 * input: expected number, received string"), which is useless in a 400 for a
 * nested body. This per-parse error map prefixes the default with the field's
 * path. A message a schema sets itself takes precedence over it — that is
 * Zod's own order — so a field can still answer in its own words, which is how
 * `/signals` keeps "unknown or missing strategy" for an absent strategy.
 */
function pathedErrors(part: string): z.core.$ZodErrorMap {
  return (iss) => {
    const fallback = z.config().localeError?.(iss);
    const message = (typeof fallback === 'string' ? fallback : fallback?.message) ?? 'invalid value';
    const path = iss.path?.length ? iss.path.join('.') : part;
    return `${path}: ${message}`;
  };
}

function summarise(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join('; ');
}

/**
 * Fastify's validator compiler for Zod schemas. It replaces the one
 * `fastify-type-provider-zod` ships only to get the messages above; returning a
 * plain `Error` (rather than Ajv-style issue objects) skips Fastify's
 * `schemaErrorFormatter`, and Fastify still stamps it with status 400, which
 * the error handler in `app.ts` answers as `{ "error": message }`.
 */
export const zodValidatorCompiler: FastifySchemaCompiler<z.ZodType> = ({ schema, httpPart }) => {
  const errorMap = pathedErrors(httpPart ?? 'body');
  return (data) => {
    const result = schema.safeParse(data, { error: errorMap });
    return result.success ? { value: result.data } : { error: new Error(summarise(result.error)) };
  };
};

/** Parse `data` against `schema`, throwing the service's 400 signal on a mismatch. */
export function parseBody<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data, { error: pathedErrors('body') });
  if (!result.success) throw new RequestError(summarise(result.error));
  return result.data;
}
