---
name: poc-to-plan
description: Reverse-engineer a working proof-of-concept into a structured project plan under backlog/plans. Use this when the user has a prototype, spike, demo, or POC (HTML/JS mockups, a script, a notebook, a folder of throwaway code) and wants it turned into a real plan that feeds the architecture pipeline. This is the POC-first sibling of idea-refiner: instead of sharpening a raw idea, it mines an existing artifact for the capabilities it already proves, the data model it implies, and the production gaps it hides. Trigger on "turn this POC into a plan", "plan from the prototype", "the poc folder is the starting point", or `/poc-to-plan poc/ PLAN-NNN`.
---

# POC → Plan

Read a proof-of-concept and emit `backlog/plans/<plan-id>.md`. The POC has
already made a hundred implicit decisions — your job is to surface them, keep
the ones worth keeping, and label the shortcuts that must NOT survive into
production. The output is a normal plan file: it flows straight into
`/plan-to-sad <plan-id> SAD-NNN` like any other.

Default POC location is `poc/`. The user may point elsewhere
(`/poc-to-plan path/ PLAN-001`). The `<plan-id>` is **required** and must match
the `PLAN-NNN` convention. Set frontmatter `parent:` to the POC source (its
path, or an idea id if one exists).

## 1. Inventory the artifact
Walk the POC and classify every file before reading deeply. Typical buckets:
- **UI / screens** — HTML, JSX, templates. Each distinct screen or view is a
  candidate capability. Look for screen labels, route markers, page titles.
- **Domain logic** — the real algorithms (in the stock-screener POC,
  `market.js` holds the indicator math: EMA/SMA/RSI, filters, scoring).
- **Data / fixtures** — mock generators, seed data, sample JSON. These reveal
  the entities and fields the product actually needs.
- **Framework / scaffolding** — support libraries, build glue, the prototype's
  homegrown rendering layer. Usually a *non-goal*, not a requirement.

Read enough of each bucket to describe it; you do not need every line.

## 2. Extract what the POC actually proves
For each bucket, pull out:
- **Demonstrated capabilities** — what a user can already do. Phrase each as a
  capability with an implied acceptance check; these become candidate `SAD#3`
  capabilities downstream, so make them slice-able.
- **Implied data model** — entities, fields, relationships inferred from the
  fixtures and logic. Feeds `SAD#6`.
- **Key algorithms / rules** — the load-bearing computations worth preserving
  verbatim. Feeds `SAD#5`.
- **Flows** — how screens connect, what state moves between them.

## 3. Separate signal from scaffolding
The POC's choices fall into three piles — name them explicitly:
- **Keep** — decisions the product should inherit (the screens, the indicator
  math, the interaction model).
- **Replace** — POC shortcuts that exist only to make the demo run: mock data
  instead of a real feed, no auth, in-memory state, the bespoke render layer.
  These become **Non-goals** and **Constraints**, never silent requirements.
- **Decide later** — ambiguities the POC dodges. These become **Open questions**.

This pile-sorting is the whole point: a POC read uncritically smuggles
throwaway choices into production scope.

## 4. Emit the plan
Write `backlog/plans/<plan-id>.md` from `backlog/plans/PLAN.template.md`. Fill
the standard sections, inferring Problem / Target users / Success metrics from
what the POC optimizes for. Then append a POC-derived block so the SAD author
inherits the mined detail:

```
---
id: PLAN-NNN
type: plan
parent: <poc-source>
source_kind: poc
---

# Project Plan — {name}

## Problem
## Target users
## Success metrics      (measurable)
## Constraints          (include real limits the POC reveals)
## Non-goals            (the "Replace" pile — explicit; flows into SAD#1.2)
## Open questions       (the "Decide later" pile)

## POC findings
### Demonstrated capabilities   (candidate SAD#3 capabilities)
### Implied data model          (feeds SAD#6)
### Load-bearing logic          (algorithms/rules to preserve — feeds SAD#5)
### POC-to-production gaps       (what "Replace" really costs)
```

## Quality bar
- Every demonstrated capability is named so a story could later verify it.
- Every "Replace" decision appears as a Non-goal or Constraint — none leak in
  as assumed requirements.
- The plan stands on its own: a reader who never saw the POC understands the
  product and where the prototype was lying to make the demo work.

Keep it tight. This is a plan, not the SAD — hand it to `/plan-to-sad` next.
