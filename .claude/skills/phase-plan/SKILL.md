---
description: Scaffold docs/<feature>-plan.md in this repo's house format — status line, context, phases table, per-phase touch scope and verify lines.
argument-hint: [feature-slug]
disable-model-invocation: true
allowed-tools: Bash(date:*), Bash(git:*), Read, Write, Grep, Glob, AskUserQuestion
---

Scaffold a plan document for the feature named in `$ARGUMENTS`, at
`docs/<feature-slug>-plan.md`.

**Refuse to overwrite.** If the file exists, say so and stop; offer to add a phase to it
instead.

**Fill what you can, mark what you cannot.** Read the code the feature touches and the
plans already in `docs/` (`screener-parity-plan.md` and `platform-hardening-plan.md` are the
reference for tone and depth), then write real content into Context and the phases table
where the repo already answers the question. Where it does not, leave an explicit
`TODO(<question>)` — an honest gap beats a plausible guess, and a scaffold full of filler is
worse than an empty file. Ask at most two questions with AskUserQuestion, and only where the
answer changes the shape of the phases.

Use `date +%F` for the status line. The skeleton, in the house format
(`.claude/rules/docs.md` is the rule; read it):

```markdown
# <Feature> — implementation plan

Status (YYYY-MM-DD): **proposed**. <One paragraph: what this changes and why it is worth
doing. Name the problem in the repo today, not the feature in the abstract.>

## Context

<What exists now, with paths. What is wrong with it. What the reader must know before
phase 1 makes sense.>

### Decisions taken — do not re-open

<Each decision, with the alternative rejected and the reason. Empty is a smell.>

## Design

<The shape of the change, module by module, with the real paths.>

## Phases

| # | Phase | Key? | Depends on |
|---|---|---|---|
| 1 | <phase> | | — |

### Phase 1 — <name>

<What it does and why it is first.>

- Touch scope: <paths and globs — the files this phase may change, and no others>
- Verify: <the acceptance test, in the form of something a person runs and observes>

## Tests

<What gets a unit test, what is checked by hand, and why that split.>

## Verification

<How to know the whole feature landed, across phases.>

## Risks

<What could go wrong, and what it would cost.>

## Out of scope (deliberately)

<What this plan will not do, so the scope stays legible later.>
```

One phase per branch and PR — size the phases so each is a reviewable change that leaves
the repo working. A phase that cannot state a Verify line someone could run is too vague to
start.

When the file is written, say where it is and which sections still carry a `TODO`.
