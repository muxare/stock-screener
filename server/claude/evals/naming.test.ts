// naming.test.ts — the guard that actually enforces the opt-in rule.
//
// Phase D's plan says opt-in is enforced by a file-name suffix, and the first
// implementation of that claim was a `test.exclude` in `vite.config.ts` listing
// `server/claude/evals/**/*.eval.ts`. It was dead configuration. Vitest's default
// include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which never matches `.eval.ts`
// in the first place, so the exclusion removed nothing and protected nothing —
// while the danger it described in its own comment stayed wide open. A paid eval
// added here and named `portfolio.test.ts` would have been collected by
// `npm test` and billed the account on every push, in CI, on a branch nobody was
// watching.
//
// This file is the guard that configuration was pretending to be. It runs in the
// ordinary suite, needs no key and costs nothing, and it fails when a file under
// `server/claude/evals/` carries a name the main suite collects, unless that file
// is on the short list below. The list is the point: adding to it is a visible,
// deliberate line in a diff, and the person who adds it is stating that the file
// is free and keyless. Nobody can drift into spending money by picking the wrong
// file name.

import { readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const EVALS_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * The only files under `server/claude/evals/` that `npm test` may collect.
 *
 * Every one of them must be free to run: no API key, no network, no cost. Add a
 * name here only after checking that is still true of it.
 */
const ALLOWED_TEST_FILES = ['score.test.ts', 'naming.test.ts'];

/**
 * This file, excluded from the two checks that read source.
 *
 * It is the one file here that has to *name* the things it forbids, so scanning
 * it for them would always match. Excluding it is safe for the reason that makes
 * it necessary: it contains those strings only inside string literals and
 * comments, and it imports nothing but `node:fs`, `node:url` and `vitest`, which
 * the first check below asserts rather than assumes.
 */
const SELF = 'naming.test.ts';

/** What Vitest's default include collects, as a predicate over a file name. */
const COLLECTED_BY_MAIN_SUITE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Every file under the evals tree, as a path relative to it, with `/` separators. */
function everyFile(): string[] {
  return readdirSync(EVALS_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const parent = entry.parentPath.slice(EVALS_DIR.length).replaceAll('\\', '/');
      return parent ? `${parent}/${entry.name}` : entry.name;
    });
}

describe('the eval directory’s naming rule', () => {
  it('finds itself, so a broken glob cannot make this test vacuous', () => {
    // Without this, a change that made `everyFile()` return nothing would turn
    // every assertion below into a guarantee about the empty set.
    expect(everyFile()).toContain(SELF);
  });

  it('imports nothing that could cost money, which is what earns it its exemption', () => {
    // SELF is excluded from the source scans below because it necessarily names
    // the strings they look for. This is the check that makes that exemption
    // honest: every import in this file, enumerated.
    const source = readFileSync(new URL(SELF, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set(['node:fs', 'node:url', 'vitest']));
  });

  it('collects no file into npm test except the ones that are free to run', () => {
    const collected = everyFile().filter((path) => COLLECTED_BY_MAIN_SUITE.test(path));
    const unexpected = collected.filter((path) => !ALLOWED_TEST_FILES.includes(path));
    expect(
      unexpected,
      'a file under server/claude/evals/ is named so that `npm test` will run it. ' +
        'If it calls the Anthropic API, rename it to *.eval.ts — it belongs to `npm run eval`. ' +
        'If it is genuinely free and keyless, add it to ALLOWED_TEST_FILES in this file.',
    ).toEqual([]);
  });

  it('keeps the API out of the files the main suite does collect', () => {
    // The naming rule stops someone adding a *new* paid file with the wrong
    // name. This stops the other half of the same mistake: a paid call added to
    // a file that is already on the allowlist.
    for (const name of ALLOWED_TEST_FILES.filter((n) => n !== SELF)) {
      const source = readFileSync(new URL(name, import.meta.url), 'utf8');
      for (const forbidden of ['@anthropic-ai/sdk', "from '../client.ts'", 'apiCaller']) {
        expect(source, `${name} reaches for ${forbidden}; npm test must stay free and keyless`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it('names every file that does call the API with the eval suffix', () => {
    // The converse check. `portfolio.eval.ts` is the only file here that spends
    // money today; if a second one appears, this says out loud what its name has
    // to be rather than leaving it to whoever reads the README.
    const spenders = everyFile().filter((path) => {
      if (!path.endsWith('.ts') || path === SELF) return false;
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      return source.includes('apiCaller(');
    });
    for (const path of spenders) {
      expect(path, `${path} calls the API and must therefore be named *.eval.ts`).toMatch(/\.eval\.ts$/);
    }
    expect(spenders).toContain('portfolio.eval.ts');
  });
});
