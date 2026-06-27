---
id: STORY-043
type: story
parent: FEAT-014
capability: CAP-dag-lower
sad_refs: [SAD-002#5.3, SAD-002#5.1, SAD-002#6.4, SAD-002#2.1]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
reject_reason: ~
---

## User Story
As an engine developer, I want one shared lowering layer that maps existing
`IndicatorDef`s, rule operands, and PCF output onto DAG nodes, so that indicators,
rules, and PCF cannot diverge and all evaluate through the same DAG.

## Context
The heaviest story of the refactor. Depends on the node model (STORY-039), the
algebraic nodes (STORY-041), and the relational nodes (STORY-042) — the existing
`×mult/+add` arithmetic and comparison operators lower into those. PCF output
(`SAD-001#3.5`) lowers through the **same** path (no second PCF evaluator).
Persisted def/rule JSON is unchanged and lowered at evaluation time
(SAD-002#6.4). Parity is the gate (STORY-046).

## Acceptance Criteria
- [ ] Every existing `IndicatorDef` type (`ema`, `sma`, `rsi`, `macd`, `stochrsi`,
      `price`) lowers to a DAG that evaluates **bar-for-bar identical** to the
      current engine (SAD-002#3.2, SAD-002#2.1).
- [ ] Rule operands `group`/`chain`/`cond`/`ind` lower to nodes, preserving bar
      offsets and `×mult/+add` arithmetic **exactly** (via the STORY-041/042 node
      kinds) (SAD-002#3.2, SAD-002#5.3).
- [ ] `srcArr` source semantics (close/open/high/low/hl2/hlc3/volume) are reused,
      not re-derived differently (SAD-002#5.3).
- [ ] `parsePCF` output lowers through the **same** lowering path — there is no
      second PCF-specific evaluation path (SAD-002#5.3).
- [ ] Every `PRESETS` entry lowers to a DAG that evaluates bar-for-bar identical
      to the current engine over the fixtures (SAD-002#3.2, SAD-002#2.1).
- [ ] Persisted `IndicatorDef`/`Rule` JSON shapes are **unchanged**; lowering
      happens at evaluation time with no saved-artifact migration (SAD-002#6.4).
- [ ] Lowering functions are pure and isomorphic (SAD-002#2.2).

## Architectural Constraints (from SAD)
- One lowering path shared by indicators, rules, and PCF so they cannot diverge;
  preserve bar offsets and arithmetic exactly; reuse `srcArr` source semantics
  (SAD-002#5.3). Do NOT add a second PCF evaluation path or re-implement
  arithmetic differently from the algebraic nodes.
- No persisted-artifact schema change or migration in this scope (SAD-002#6.4 /
  ADR-007) — defs/rules stay in their current JSON form.
- Bar-for-bar parity is the gate, run via the harness (STORY-046, SAD-002#2.1).

## Out of scope
- The algebraic / relational node kinds themselves — STORY-041 / STORY-042
  (this story lowers existing operators onto them).
- Pattern lowering — STORY-044.
- Changing the public `indSeries`/`eval*` signatures — STORY-045.
- Any persisted def/rule schema change or migration (SAD-002#6.4 / SAD-002#1.2).

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
