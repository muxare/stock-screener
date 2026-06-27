---
id: STORY-046
type: story
parent: FEAT-016
capability: CAP-dag-fidelity
sad_refs: [SAD-002#5.5, SAD-002#2.1, SAD-002#2.2]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engineer trusting the numbers, I want a differential harness that diffs
old-engine vs new-engine output bar-for-bar across indicators, presets, and PCF
over the golden-master fixtures, so that any divergence fails CI before it can
reach users.

## Context
The cross-cutting fidelity gate (SAD-002#7) — every lowering/evaluation story
runs it. Per ADR-002 (SAD-002#8.2), the **old** engine path stays available as
the reference (e.g. pinned reference output) until parity is locked. Drives off
the existing synthetic fixture universe (`SAD-001#8.7` / ADR-007 — see
`src/lib/data/synthetic.ts`). Stand it up early so each piece is provable as it
lands.

## Acceptance Criteria
- [ ] A test harness runs the old engine and the new engine over the golden-master
      fixture universe and asserts **bar-for-bar** equality on the **raw series**
      (not rounded/printed values) (SAD-002#5.5, SAD-002#2.1).
- [ ] Coverage includes **every** indicator type, **every** `PRESETS` entry, and
      the PCF example (SAD-002#3.8, SAD-002#2.1).
- [ ] Full-series parity is checked — no sampling of a subset of bars
      (SAD-002#5.5).
- [ ] Any divergence **fails CI** (the harness runs under `vitest run`) — it is a
      gate, not a target (SAD-002#2.1).
- [ ] The old engine path remains available as the differential reference until
      parity is locked (SAD-002#8.2).
- [ ] The harness is driven from the synthetic adapter fixtures read-only and adds
      no I/O to the engine (SAD-002#2.2).

## Architectural Constraints (from SAD)
- Drive from the existing fixture universe (`SAD-001#8.7` / ADR-007 synthetic
  adapter); fail CI on any divergence; keep the old engine path available until
  parity is locked (SAD-002#5.5, SAD-002#8.2). Do NOT assert on rounded/printed
  values or sample a subset of bars when full-series parity is the contract.
- The harness is test-only; it must not become a production dependency
  (SAD-002#7).

## Out of scope
- The compatibility shims / preserved signatures — STORY-045.
- A latency benchmark — that posture rides with the evaluator story (STORY-040,
  SAD-002#2.5).
- Modifying engine behaviour to make tests pass (the harness only observes;
  divergence is fixed in the relevant lowering/eval story).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/*.test.ts
- src/lib/dag/**
