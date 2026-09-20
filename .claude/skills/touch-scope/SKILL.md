---
description: List the files this branch changes that fall outside the touch scope declared by its plan. Use before opening a PR, or when asked whether a branch has drifted beyond its plan.
argument-hint: [plan path and phase, e.g. docs/cca-f-learning-plan.md A.2]
allowed-tools: Bash(git:*), Bash(gh pr:*), Read, Grep, Glob
context: fork
agent: Explore
background: false
---

Read-only. Report drift; never edit a file and never edit the plan to match the diff.

**1. Collect what the branch changes.** Committed and uncommitted both count:

```
git merge-base HEAD main
git diff --name-only $(git merge-base HEAD main)..HEAD
git status --porcelain
```

**2. Find the plan and the phase.** In this order, stopping at the first that answers:

- `$ARGUMENTS`, when given — a plan path and a phase id.
- The PR for this branch: `gh pr view --json body` and look for a `Plan: docs/<x>-plan.md`
  line with a phase. That line is the convention this repo's PRs use.
- The branch name. `cca-f/phase-a-2-skills` names `docs/cca-f-learning-plan.md`, phase A.2;
  `feat/screener-parity-phase1` names `docs/screener-parity-plan.md`, phase 1.
- Failing all three, list the candidates from `docs/*-plan.md` and ask which one, rather
  than guessing.

**3. Read the phase's declared scope.** Plans in `docs/` carry a `Touch scope:` line per
phase — a comma-separated list of paths and globs. Use the line for the phase in hand. If
the phase has no such line, say so and stop; an absent scope is a gap in the plan, not a
pass.

**4. Compare, and judge.** Match each changed path against the globs. Always in scope,
whatever the plan says, because the process requires them:

- `docs/development-diary.md`
- the plan document itself

Then report:

```
Plan: docs/<x>-plan.md, phase <N>
Scope: <the declared globs>
In scope:     <count> files
Out of scope: <count> files
```

and, for each out-of-scope file, one line: `path — <why it is outside>`. Close with a
verdict of one sentence: either the branch is inside its scope, or it is not and here is
the choice — revert the stray files, or widen the plan's touch scope deliberately and say
so in the diary entry. Do not make that choice yourself.
