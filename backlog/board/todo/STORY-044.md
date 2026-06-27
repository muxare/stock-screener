---
id: STORY-044
type: story
parent: FEAT-015
capability: CAP-pattern-nodes
sad_refs: [SAD-002#5.1, SAD-002#2.1, SAD-002#2.2]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer, I want the `PATTERNS` set expressed as boolean DAG nodes
consuming raw + indicator levels, so that price-action patterns compose in the
same calculus as every other node while keeping their exact truth values.

## Context
Depends on the node model (STORY-039) and the relational/algebraic node kinds
(STORY-041/042). Per ADR-005 (SAD-002#8.5), patterns become boolean DAG nodes but
must match `evalPatternAt` (`SAD-001#3.7`) bar-for-bar, including multi-bar and
`n`-parameterised patterns. This is what lets patterns later participate in the
deferred temporal layer.

## Acceptance Criteria
- [ ] Each pattern in `PATTERNS` (`SAD-001#3.7`) is expressed as a boolean DAG
      node consuming raw + indicator-level inputs (SAD-002#3.6, SAD-002#8.5).
- [ ] Each pattern node's flag matches `evalPatternAt` **bar-for-bar** over the
      fixture series (SAD-002#3.6, SAD-002#2.1).
- [ ] Multi-bar patterns and `n`-parameterised patterns produce identical results
      to the current evaluator (SAD-002#3.6).
- [ ] Pattern nodes carry derived level from their inputs and remain immutable,
      serialisable, and pure/isomorphic (SAD-002#5.1, SAD-002#2.2).
- [ ] Pattern flags are computed through the evaluator (memoised, prunable) like
      any other node — no separate per-bar pattern cache path.

## Architectural Constraints (from SAD)
- Expose patterns as boolean DAG nodes over raw + indicator levels while
  preserving the exact `evalPatternAt` truth values (SAD-002#8.5, SAD-002#3.6).
- Keep nodes immutable/serialisable/dependency-free (SAD-002#5.1, SAD-002#2.2).
- Bar-for-bar parity gated by the harness (STORY-046, SAD-002#2.1).

## Out of scope
- Any temporal/sequencing composition of patterns (`THEN`/`WITHIN`/onset) — out
  of scope for the whole plan (SAD-002#1.2); the seam is STORY-047.
- New pattern types or new pattern math (SAD-002#1.2).
- Surfacing patterns in the setup/indicator builders (authoring UX, SAD-002#1.2).

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
