---
description: Run the repo's typecheck, lint and test gates and report one screen of pass/fail. Use before opening a PR, before marking a plan phase landed, or whenever asked to verify that the working tree is clean.
allowed-tools: Bash(npm run:*), Bash(tail:*), Read
context: fork
agent: Explore
background: false
effort: low
---

Run the three gates this repo treats as the definition of done, and report the result.
Report only — never fix, never edit, never commit.

Run all three from the repo root, in this order, and run every one of them even when an
earlier one fails. A summary that stops at the first failure is the thing this skill
exists to avoid:

1. `npm run typecheck 2>&1 | tail -40`
2. `npm run lint 2>&1 | tail -40`
3. `npm run test 2>&1 | tail -40`

`npm run test` is `vitest run`, which exits on its own — never add `--watch`, never
background it, and wait for it; the suite is a few seconds.

Then reply with this table and nothing above it:

```
typecheck  pass|fail
lint       pass|fail   (E errors, W warnings)
test       pass|fail   (P passed, F failed, S skipped)
```

If all three passed, add one line saying so, and stop.

If anything failed, list up to five failures below the table, most significant first, one
line each as `path:line — message`, then one final line naming the single next thing to
look at. Quote the tool's own wording rather than paraphrasing an error into something
friendlier. If a command could not run at all — missing script, missing dependency — say
that, instead of reporting it as a failure of the code.
