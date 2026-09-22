// claude/evals/portfolio.eval.ts — the run that costs money.
//
// Named `*.eval.ts`, not `*.test.ts`, and that suffix is the whole opt-in
// mechanism. `npm test` runs Vitest's default include, `**/*.{test,spec}.…`,
// which this name does not match; `vitest.eval.config.ts` includes this name and
// nothing else. A file called `portfolio.test.ts` in this folder would join the
// ordinary suite and start billing the Anthropic account on every push, in CI, on
// a branch nobody was watching — which is what `naming.test.ts` is there to
// refuse. (An earlier version of this comment credited a `test.exclude` in
// `vite.config.ts`. That exclusion was dead: the default include never matched
// `.eval.ts` in the first place, so it removed nothing and guarded nothing. It
// has been deleted and replaced by the test.)
//
// Everything expensive happens here and nothing else does: the arithmetic is in
// `score.ts`, the rendering is in `report.ts`, and both are pure and covered by
// an ordinary keyless test. What is left in this file is I/O, one API call per
// fixture, and the assertion that the floors held.
//
// The call goes through `extractPortfolio` with the production `apiCaller`, so
// what is measured is the service's own path — the same prompt bytes, the same
// schema, the same meaning checks and the same two-attempt repair loop. An eval
// that reimplemented any of that would be scoring a copy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { config } from '../../config.ts';
import { anthropic } from '../client.ts';
import { toClaudeError } from '../errors.ts';
import { extractPortfolio, apiCaller, IMAGE_MEDIA_TYPES } from '../portfolio/extract.ts';
import type { ExtractionCaller, ImageMediaType } from '../portfolio/extract.ts';
import { ExtractionSchema } from '../portfolio/schema.ts';
import type { BarLookup } from '../portfolio/validate.ts';
import { scoreRun, checkFloors, FLOORS } from './score.ts';
import type { CaseMode, CaseResult, ScoredRun } from './score.ts';
import { renderReport } from './report.ts';
import { WEAKENED_SYSTEM_PROMPT, withSystemPrompt } from './weakened.ts';

const FIXTURES = new URL('./fixtures/', import.meta.url);

/**
 * The universe knows none of these tickers, and that is deliberate.
 *
 * `validateExtraction` checks an average price against the range the instrument
 * has actually traded in, which it can only do for a ticker the market-data store
 * holds. The fixtures are invented names attached to invented numbers — that is
 * what makes them publishable — so no real bar series could confirm or refute
 * them, and inventing one would mean inventing a *second* expected answer that
 * has to stay consistent with the first. An empty lookup therefore leaves that
 * one check inert and exercises the other two (arithmetic, internal consistency)
 * exactly as the service runs them. The consequence to remember when reading a
 * report: this eval measures reading, not plausibility against the market.
 */
const NO_BARS: BarLookup = { getInstrument: () => null };

interface ManifestCase {
  id: string;
  image: string;
  mediaType: ImageMediaType;
  mode: CaseMode;
  expected: string;
  note?: string;
}

/**
 * The whole run, not one fixture.
 *
 * Adaptive thinking over a dense table is not fast and a repair attempt doubles
 * it, so a handful of fixtures run one after another is minutes rather than
 * seconds. Fifteen is far above anything phase C measured and is here to stop a
 * hung request from holding a terminal open all afternoon, not to pace the run.
 */
const RUN_TIMEOUT_MS = 15 * 60_000;

const MODES: readonly CaseMode[] = ['exact', 'all-null', 'empty'];

function loadManifest(): ManifestCase[] {
  const path = new URL('manifest.json', FIXTURES);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `no fixtures found at ${fileURLToPath(FIXTURES)}. ` +
        'Render them first with `npm run eval:fixtures`.',
    );
  }
  const parsed: unknown = JSON.parse(raw);
  const cases = (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('fixtures/manifest.json has no `cases` array');
  }
  // Validated by hand rather than with Zod because the failure this guards
  // against is a typo in a checked-in file, and the message a human needs is
  // "case 3 has a mode this harness does not know", naming the case.
  return cases.map((entry, index) => {
    const c = entry as Partial<ManifestCase>;
    const where = `manifest case ${index + 1}${c.id ? ` (${c.id})` : ''}`;
    if (!c.id || !c.image || !c.expected) throw new Error(`${where}: id, image and expected are required`);
    if (!MODES.includes(c.mode as CaseMode)) {
      throw new Error(`${where}: mode must be one of ${MODES.join(', ')}, got ${String(c.mode)}`);
    }
    if (!IMAGE_MEDIA_TYPES.includes(c.mediaType as ImageMediaType)) {
      throw new Error(`${where}: mediaType must be one of ${IMAGE_MEDIA_TYPES.join(', ')}`);
    }
    return c as ManifestCase;
  });
}

/**
 * The variant under test.
 *
 * Read straight from the environment rather than through `server/config.ts`,
 * which is the one place the *service* reads its environment. `EVAL_PROMPT` is a
 * harness knob with no meaning to a running server, and putting it in
 * `ServerConfig` would make every boot validate a variable no request has ever
 * depended on.
 */
function chooseCaller(): { caller: ExtractionCaller; variant: string; weakened: boolean } {
  const requested = process.env.EVAL_PROMPT ?? '';
  if (requested === 'weakened') {
    return {
      caller: apiCaller(withSystemPrompt(anthropic(), WEAKENED_SYSTEM_PROMPT)),
      variant: 'WEAKENED prompt (control run — its score is meant to be worse)',
      weakened: true,
    };
  }
  if (requested !== '') {
    throw new Error(`EVAL_PROMPT must be unset or "weakened", got "${requested}"`);
  }
  return { caller: apiCaller(), variant: 'production prompt', weakened: false };
}

describe('portfolio extraction eval', () => {
  let run!: ScoredRun;
  let violations!: string[];
  let weakened = false;
  let fixtureCount = 0;

  beforeAll(async () => {
    // Fail here, with a sentence, rather than letting the SDK throw a 401 stack
    // trace five fixtures deep or — worse — letting a `beforeAll` hang while
    // something retries. The key is read through `config.ts`, which has already
    // checked its shape and reports it as `[set]` if anything logs the config.
    if (!config.anthropicApiKey) {
      throw new Error(
        'npm run eval needs ANTHROPIC_API_KEY. Put it in .env at the repo root ' +
          '(the script loads it with --env-file-if-exists) or export it in this shell. ' +
          'This suite makes real, paid API calls; that is why it is not part of npm test.',
      );
    }

    // Which prompt, before which fixtures: a typo in EVAL_PROMPT should be
    // reported as a typo in EVAL_PROMPT, not as a missing fixture set.
    const chosen = chooseCaller();
    const { caller, variant } = chosen;
    weakened = chosen.weakened;
    const cases = loadManifest();
    fixtureCount = cases.length;

    // Sequential on purpose. Concurrency would finish sooner and would also make
    // a rate limit look like a quality regression, which is the one confusion an
    // eval must not introduce.
    const results: CaseResult[] = [];
    for (const fixture of cases) {
      const image = {
        mediaType: fixture.mediaType,
        dataBase64: readFileSync(new URL(fixture.image, FIXTURES)).toString('base64'),
      };
      // Read outside the try: a malformed expected file is a mistake in this
      // repository, not a result about the model, and it should stop the run
      // loudly rather than be scored as a failed extraction.
      const expected = ExtractionSchema.parse(
        JSON.parse(readFileSync(new URL(fixture.expected, FIXTURES), 'utf8')),
      );

      // One fixture's failure must not discard the fixtures already paid for.
      // A 429 or a 529 on the last of five would otherwise throw out of this
      // loop, and the four answers above it — bought and never scored — would go
      // unreported, which is precisely what this file's header says must not
      // happen. The category is recorded, the case is charged as a total miss by
      // the scorer, and the run continues so the report covers everything.
      try {
        const { extraction, attempts, problems } = await extractPortfolio(image, NO_BARS, caller);
        results.push({ id: fixture.id, mode: fixture.mode, expected, actual: extraction, attempts, problems });
      } catch (err) {
        // Only the category reaches the report. `toClaudeError` maps the SDK's
        // typed classes; an unmapped throw still becomes a `ClaudeError`, so
        // there is no path here that puts a raw message on the screen.
        const claudeError = toClaudeError(err);
        results.push({
          id: fixture.id,
          mode: fixture.mode,
          expected,
          actual: { accountLabel: null, holdings: [], warnings: [] },
          attempts: 0,
          problems: [],
          error: claudeError.category,
        });
      }
    }

    run = scoreRun(results);
    violations = checkFloors(run, FLOORS);
    // The one place this harness writes to the console. Vitest swallows nothing
    // here because the report is the deliverable: a paid run whose numbers are
    // not printed has to be paid for twice.
    console.log(`\n${renderReport(run, { variant, violations })}\n`);
  }, RUN_TIMEOUT_MS);

  it('answers every fixture in the manifest', () => {
    expect(fixtureCount).toBeGreaterThan(0);
    expect(run.overall.cases).toBe(fixtureCount);
  });

  it('meets the floor for every mode', () => {
    // A weakened run inverts the assertion rather than skipping it. If a prompt
    // with no null rule, no number-format rule and one currency field where there
    // are two still clears every floor, the floors are measuring the fixtures
    // instead of the prompt — and every future "the eval delta says this helped"
    // would be worthless. A red run here is the harness telling the truth about
    // itself, and the fix is a harder fixture or a tighter floor, never a softer
    // assertion.
    if (weakened) {
      expect(
        violations.length,
        'the weakened prompt met every floor: the floors are not discriminating between prompts',
      ).toBeGreaterThan(0);
      return;
    }
    expect(violations, violations.join('; ')).toEqual([]);
  });
});
