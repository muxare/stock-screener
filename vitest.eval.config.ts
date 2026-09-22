import { defineConfig } from 'vitest/config';

// The opt-in suite (phase D of docs/cca-f-learning-plan.md).
//
// Separate from vite.config.ts rather than a project inside it, because the two
// suites differ in the one way that matters: this one spends money and needs a
// key. A configuration that could be reached by `vitest run` with no arguments is
// a configuration that will be, eventually, by CI.
//
// `include` names the eval suffix and nothing else, and the default include is
// deliberately not extended — a `*.test.ts` file dropped in server/claude/evals/
// belongs to `npm test`, where it is free, and must not be collected twice.
export default defineConfig({
  test: {
    include: ['server/claude/evals/**/*.eval.ts'],
    // One fixture at a time, one file at a time. Concurrency here would turn a
    // rate limit into something that reads like a quality regression, and would
    // interleave two runs' console output into one unreadable report.
    fileParallelism: false,
    // The report is the deliverable of a paid run, so it has to reach the
    // terminal whole rather than being folded away under a passing test.
    disableConsoleIntercept: true,
    // A run that has to re-read every fixture is a run that has to be paid for
    // again; nothing here is worth retrying automatically.
    retry: 0,
  },
});
