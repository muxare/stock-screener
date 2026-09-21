// Renders .github/claude/pr-review.md into the prompt that phase B feeds to headless
// Claude Code, and writes it to stdout.
//
// The pull-request body is text a stranger can write — this repository is public — and it
// travels into the same string as the instructions. Two things keep that honest. The body
// reaches this script through the environment rather than through a shell interpolation,
// so no quoting mistake in the workflow can turn it into a command; and every sequence
// that would close one of the prompt's own data tags is neutralised here, so the body
// cannot end its own block and continue as if it were the prompt. The prompt says the
// blocks are data; this makes the blocks hold.
import { readFile } from 'node:fs/promises';

const TEMPLATE = new URL('./pr-review.md', import.meta.url);
const TAGS = ['pr_body', 'changed_files', 'branch', 'latest_commit_date', 'example'];

/** Defang the prompt's own tag vocabulary inside injected data. */
function neutralise(value) {
  return TAGS.reduce(
    (text, tag) => text.replace(new RegExp(`<(/?)(${tag})>`, 'gi'), '&lt;$1$2&gt;'),
    value ?? '',
  );
}

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is empty; the workflow must set it.`);
  return value;
};

const substitutions = {
  // A pull request may genuinely have no body. That is not an error; it is a body that
  // names no plan, and the touch-scope check falls back to the branch name.
  PR_BODY: neutralise(process.env.PR_BODY).trim() || '(the pull request has no body)',
  CHANGED_FILES: neutralise(required('CHANGED_FILES')).trim(),
  BRANCH: neutralise(required('BRANCH')).trim(),
  LATEST_COMMIT_DATE: neutralise(required('LATEST_COMMIT_DATE')).trim(),
};

let prompt = await readFile(TEMPLATE, 'utf8');
for (const [key, value] of Object.entries(substitutions)) {
  prompt = prompt.replaceAll(`{{${key}}}`, () => value);
}

const unfilled = prompt.match(/\{\{[A-Z_]+\}\}/g);
if (unfilled) throw new Error(`placeholder left unfilled: ${[...new Set(unfilled)].join(', ')}`);

process.stdout.write(prompt);
