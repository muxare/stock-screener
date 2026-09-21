// claude/client.ts — the one Anthropic client this process constructs, and the
// standing model settings from stage 7 of `docs/platform-hardening-plan.md`.
//
// Construction is lazy on purpose. `config.ts` already validates the key's shape
// at import, but a service with no key must still boot and serve every other
// route — the screener does not depend on this feature — so the client is built
// on first use and a missing key becomes a `not_configured` answer from the one
// endpoint that needs it rather than a failed boot.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import type { ServerConfig } from '../config.ts';
import { ClaudeError } from './errors.ts';

/**
 * Stage 7's standing rules, in one place.
 *
 * `claude-opus-5` unless there is a measured reason otherwise, and reading a
 * dense broker table off a screenshot is exactly the kind of reason there is
 * not one for. Adaptive thinking, because share counts and average prices in a
 * compressed screenshot repay looking twice; `budget_tokens` is removed on this
 * model and sending it is a 400.
 */
export const MODEL = 'claude-opus-5';

/** Non-streaming, so the ceiling stays under the SDK's HTTP timeout. */
export const MAX_TOKENS = 16_000;

let cached: Anthropic | null = null;
let cachedFor: string | null = null;

/**
 * The client, or a `not_configured` ClaudeError when the environment has no key.
 *
 * `cfg` is injectable for tests only; the default is the process configuration.
 */
export function anthropic(cfg: ServerConfig = config): Anthropic {
  const key = cfg.anthropicApiKey;
  if (!key) {
    throw new ClaudeError(
      'not_configured',
      'this feature needs ANTHROPIC_API_KEY, which is not set in this environment',
    );
  }
  if (cached && cachedFor === key) return cached;
  cached = new Anthropic({ apiKey: key });
  cachedFor = key;
  return cached;
}

/** Drops the memoised client. Tests use it; nothing in the service does. */
export function resetAnthropic(): void {
  cached = null;
  cachedFor = null;
}
