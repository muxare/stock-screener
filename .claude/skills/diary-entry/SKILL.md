---
description: Draft the development-diary entry for a landed plan phase, in this repo's house format, from the branch diff and the plan's own text.
argument-hint: [plan phase, e.g. A.2 or "cca-f A.2"]
disable-model-invocation: true
context: fork
agent: diary-writer
---

Write the diary entry for the phase named in `$ARGUMENTS`, and stop.

The format, the sources to read and the rules about dates are the `diary-writer` agent's
own instructions — `.claude/agents/diary-writer.md` — so that the diary format is stated
once and cannot drift between the command and the agent. Follow them.

Two things this invocation adds:

- If `$ARGUMENTS` is empty, work the phase out from the branch name the way `/touch-scope`
  does (`cca-f/phase-a-4-subagents` → `docs/cca-f-learning-plan.md`, phase A.4), and say
  which plan and phase you settled on before you write anything.
- The reply is what the caller reads: show the entry in full, because reviewing it here is
  cheaper than reviewing it as a diff.
