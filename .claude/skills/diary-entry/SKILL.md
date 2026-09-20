---
description: Draft the development-diary entry for a landed plan phase, in this repo's house format, from the branch diff and the plan's own text.
argument-hint: [plan phase, e.g. A.2 or "cca-f A.2"]
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(date:*), Read, Grep, Glob, Edit
---

Write one diary entry for the phase named in `$ARGUMENTS`, and stop. Do not commit, do not
push, do not touch the code, and do not edit any file other than
`docs/development-diary.md` and the plan's status line.

**1. Get today's date** with `date +%F`. Never infer it, and never copy the date from the
entry above — a wrong date makes the diary useless as a record.

**2. Read what actually happened**, in this order:

```
git diff --stat $(git merge-base HEAD main)..HEAD
git log --oneline $(git merge-base HEAD main)..HEAD
git diff $(git merge-base HEAD main)..HEAD
git status --porcelain
```

If the working tree still has uncommitted changes that belong to the phase, include them —
the entry describes the phase, not the commits so far.

**3. Read the phase's own text** in `docs/<feature>-plan.md`: what it set out to do, its
touch scope, its verify line. The entry says how the landed thing differs from the plan
where it does, and why — that difference is the most valuable line in any entry.

**4. Read `.claude/rules/docs.md` and the two entries at the top of the diary** and match
them. The format is not negotiable: newest entry first, headed `## YYYY-MM-DD — <short
title>`, then

- **What changed** — what the phase did and *why*, in prose. Not a changelog of commits.
  Where a decision was taken, name the alternative that was rejected and the reason.
- **Where it lives** — the paths, so the next reader finds it without a search.
- **How to test** — the commands or the manual steps someone else would run.

Absolute dates, never "last week". Prose, not bullet soup. It is a record for a reader who
was not here, including the version of yourself six months from now.

**5. Update the plan's status line** to match — the dated `Status (YYYY-MM-DD): **…**` line
at the top, saying which phases have landed.

**6. Show the entry** in the reply and say what you changed. If the diff and the plan
disagree about what the phase was, say so plainly instead of writing around it.
