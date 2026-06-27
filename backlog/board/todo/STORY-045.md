---
id: STORY-045
type: story
parent: FEAT-016
capability: CAP-dag-compat
sad_refs: [SAD-002#5.4, SAD-002#2.3, SAD-002#2.2]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As a consumer of the engine (components and the store), I want the existing
exported engine API and `PRESETS`/catalogues to keep working unchanged on top of
the new DAG model, so that no consuming code has to change for the refactor.

## Context
Depends on lowering (STORY-043) and the evaluator (STORY-040). Per ADR-002
(SAD-002#8.2), the refactor is in-place behind unchanged exports: the old entry
points route through lowering + evaluator. This is the guarantee that
`SAD-001#5.2/5.3/5.4` and the store (`SAD-001#5.9`) are untouched.

## Acceptance Criteria
- [ ] These exports keep their **signatures and behaviour**, implemented over the
      new model: `indSeries`, `evalRuleAt`, `evalGroupedRules`, `evalGroupAt`,
      `evalCondAt`, `evalChainAt`, `evalIndRuleAt`, `evalPatternAt`, `rankPassSet`,
      `parsePCF`, `backtestRules` (SAD-002#2.3, SAD-002#5.4).
- [ ] `PRESETS` and the builder catalogues (`SAD-001#5.6`) remain exported and
      behave identically (SAD-002#2.3).
- [ ] The existing engine + component test suites pass **unchanged**, with **no
      edits** to any consuming component (`SAD-001#5.2/5.3/5.4`) or the store
      (`SAD-001#5.9`) (SAD-002#2.3).
- [ ] Old entry points are routed through the lowering layer (STORY-043) and the
      evaluator (STORY-040) — they do not retain a parallel flat-series
      implementation (SAD-002#5.4).
- [ ] Exported signatures are unchanged; consumers are not required to adopt the
      node model in this scope (SAD-002#5.4).

## Architectural Constraints (from SAD)
- Route old entry points through lowering + evaluator; keep behaviour identical
  (SAD-002#5.4). Do NOT change exported signatures or require consumers to adopt
  the node model.
- The whole point is zero consumer churn (SAD-002#2.3) — verified by the existing
  suites passing with no consumer/store edits.
- Engine stays pure/isomorphic (SAD-002#2.2).

## Out of scope
- The differential fidelity harness — STORY-046 (this story is "consumers still
  compile and pass"; that story is "numbers are bit-identical").
- Retiring the old engine path (kept as the parity reference until parity is
  locked, SAD-002#8.2).
- Any consumer-side or store change (forbidden by SAD-002#2.3).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/market.ts
- src/lib/dag/**
- src/lib/*.test.ts
