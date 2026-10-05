// schemas/portfolio.ts — the portfolio screenshot reader (hardening stage 3).
//
// The extraction itself is `ExtractionSchema` from `server/claude/portfolio/
// schema.ts`, which is already the contract the model answers against; the
// response here wraps it rather than restating it, so the shape Claude is held
// to and the shape the browser receives are one definition. That module imports
// only `zod`, which keeps it safe for the browser program to type-check.
//
// The request schema checks shape only. Whether the media type is one the API
// takes, whether the base64 is a data URL to unwrap, and whether the image is
// small enough to send are the route's `readImage`, as before.

import { z } from 'zod';
import { ExtractionSchema } from '../claude/portfolio/schema.ts';

export const PortfolioStatusResponseSchema = z.object({
  available: z.boolean().describe('Whether this service has an ANTHROPIC_API_KEY; the UI hides the feature when not.'),
  model: z.string(),
});

export const ExtractRequestSchema = z.object({
  image: z.object({
    mediaType: z.string().optional().describe('image/png, image/jpeg, image/gif or image/webp; implied by a data URL.'),
    dataBase64: z.string().describe('The image as base64, or as a data URL.'),
  }),
});

export const ExtractResponseSchema = z.object({
  extraction: ExtractionSchema,
  attempts: z.number().describe('1 or 2: the service retries a failed validation exactly once.'),
  problems: z.array(z.string()).describe('Meaning checks still failing when the attempts ran out. Usually empty.'),
});

/**
 * A failure from the model layer carries a category and a retry hint beside the
 * message (`ClaudeError.toWire()`); a malformed request is the plain error
 * shape. Both are this one schema, with the two extra fields optional.
 */
export const PortfolioErrorResponseSchema = z.object({
  error: z.string(),
  errorCategory: z
    .enum(['not_configured', 'invalid_input', 'auth', 'rate_limited', 'extraction_failed', 'upstream'])
    .optional(),
  isRetryable: z.boolean().optional(),
});

export type PortfolioStatusResponse = z.output<typeof PortfolioStatusResponseSchema>;
export type ExtractRequest = z.input<typeof ExtractRequestSchema>;
export type ExtractResponse = z.output<typeof ExtractResponseSchema>;
