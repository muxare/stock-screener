---
id: STORY-058
type: story
parent: FEAT-014
capability: CAP-dag-lower
sad_refs: [SAD-002#5.3, SAD-002#6.4, SAD-002#2.1, SAD-002#2.2]
target: ~
estimate: ~
work_type: feature
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer, I want rule operands (`group`/`chain`/`cond`/`ind`), every
`PRESETS` entry, and `parsePCF` output to lower onto DAG nodes through the **same**
lowering path as indicators, so that rules, presets, and PCF cannot diverge and all
evaluate through the DAG bar-for-bar identically to today's engine.

## Context
Split out of STORY-043 at the Exception gate (2026-07-09): these are STORY-043's
AC#2/#4/#5, deferred because they require the offset/affine/const lowering primitive
(**STORY-057**), which did not exist. STORY-043 landed the indicator half (AC#1/#3/#6
+ the macd/stochrsi fidelity reroute); this story finishes lowering onto the DAG.
**Depends on STORY-057** (the primitive) and STORY-043 (the indicator lowering layer
`dag/lower.ts` + composite kernels it extends).

## Acceptance Criteria
- [ ] Rule operands `group`/`chain`/`cond`/`ind` lower to nodes, preserving bar
      offsets and `×mult/+add` arithmetic **exactly** via the STORY-041/057 node
      kinds/params (SAD-002#5.3), bar-for-bar vs `evalGroupAt`/`evalRuleAt`.
- [ ] `parsePCF` output lowers through the **same** lowering path — there is no
      second PCF-specific evaluation path (SAD-002#5.3).
- [ ] Every `PRESETS` entry lowers to a DAG that evaluates bar-for-bar identical to
      the current engine over the fixtures (SAD-002#2.1).
- [ ] The `fidelity.test.ts` `preset:*` and `pcf:*` subjects move from the pinned
      reference to the LIVE old-vs-new differential (as STORY-043 did for the
      indicators); coverage is not weakened or dropped (SAD-002#5.5).
- [ ] Persisted `IndicatorDef`/`Rule` JSON shapes are **unchanged**; lowering happens
      at evaluation time with no saved-artifact migration (SAD-002#6.4).
- [ ] Lowering functions are pure and isomorphic (SAD-002#2.2).

## Architectural Constraints (from SAD)
- One lowering path shared by indicators, rules, and PCF (SAD-002#5.3) — extend
  `dag/lower.ts` (STORY-043), do NOT add a second PCF/rule evaluator.
- ⚠ Carry-over from STORY-043 review: `dag/kernels/composite.ts` `stochrsiNormalise`
  casts its RSI input `r[j] as number` with no null-guard (faithful to `market.ts`
  today, fed a null-free `rsi(src)`). If this story ever feeds a `stochrsi` node an
  input carrying warm-up nulls (e.g. an `sma`), `null < Infinity` corrupts the
  rolling window — add a null-guard then.
- No persisted-artifact schema change or migration (SAD-002#6.4 / ADR-007).
- Bar-for-bar parity is the gate, via the fidelity harness (SAD-002#2.1).

## Out of scope
- The offset/affine/const primitive itself — STORY-057.
- The indicator lowering layer + composite kernels — STORY-043.
- Changing the public `indSeries`/`eval*` signatures — STORY-045 (the compat shim).

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/lib/dag/lower.ts        # extend STORY-043's lowering: rule operands / GroupRule / PCF → nodes
- src/lib/dag/lower.test.ts   # operand/preset/PCF lowering unit tests
- src/lib/fidelity.test.ts    # reroute preset:*/pcf:* subjects pinned → live-differential
# Depends on STORY-057 (primitive) + STORY-043 (indicator lowering). Do NOT edit
# market.ts (lower purely under dag/, reading the old path only as the parity oracle).
