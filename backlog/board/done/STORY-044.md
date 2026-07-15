---
id: STORY-044
type: story
parent: FEAT-014
capability: CAP-pattern-nodes
sad_refs: [SAD-002#5.1, SAD-002#2.1, SAD-002#2.2]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: fe7213c7382b1e0915caf85b7495d8ac0bf5d75d
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
- [x] Each pattern in `PATTERNS` (`SAD-001#3.7`) is expressed as a boolean DAG
      node consuming raw + indicator-level inputs (SAD-002#3.6, SAD-002#8.5).
- [x] Each pattern node's flag matches `evalPatternAt` **bar-for-bar** over the
      fixture series (SAD-002#3.6, SAD-002#2.1).
- [x] Multi-bar patterns and `n`-parameterised patterns produce identical results
      to the current evaluator (SAD-002#3.6).
- [x] Pattern nodes carry derived level from their inputs and remain immutable,
      serialisable, and pure/isomorphic (SAD-002#5.1, SAD-002#2.2).
- [x] Pattern flags are computed through the evaluator (memoised, prunable) like
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
- src/lib/dag/pattern.ts          # new: PATTERNS → boolean DAG nodes (ADR-005, SAD-002#8.5)
- src/lib/dag/pattern.test.ts     # new: bar-for-bar parity vs evalPatternAt (this lane's OWN file, not fidelity.test.ts)
- src/lib/dag/kernels/pattern.ts  # fill the pattern kernel; module seam created by STORY-056
- src/lib/dag/eval.test.ts         # AMENDED (Exception gate 2026-07-09): shared reserved-kinds firewall test — registering the pattern kernel un-reserves `pattern`, so this lane drops ONLY that case (leaves macd reserved). Shared with STORY-043 (un-reserves stochrsi); serialized by merge order (044 merges first, 043 rebases on top) so the two lanes never conflict on this file.
# Narrowed from {src/lib/market.ts, src/lib/dag/**, src/lib/*.test.ts} (/refine): specific file
# paths, no ** globs, so {043,044} are pairwise-disjoint for the fanout guard. This lane does NOT
# edit src/lib/market.ts — it only READS the exported PATTERNS/evalPatternAt (market.ts:1058/1086)
# as the parity oracle (imports, not edits) and builds pattern nodes over indicator/raw nodes via
# the STORY-039 node model. It does NOT touch src/lib/fidelity.test.ts (that file has no pattern
# subject — STORY-043 owns it); pattern parity lives in its own pattern.test.ts.
