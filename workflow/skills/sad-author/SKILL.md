---
name: sad-author
description: Author a Software Architecture Document (SAD) from a project plan, using a fixed template with stable section anchors. Use this when the user wants to write a SAD, create an architecture document, turn a project plan into architecture, or produce the technical design that the backlog will reference. Trigger on "write the SAD", "create the architecture doc", "design the system", `/plan-to-sad PLAN-NNN SAD-NNN`, or moving from project plan to technical design. Critical: produces the anchored sections (SAD#3 capabilities, SAD#5 components, SAD#6 data) that every story later cites.
---

# SAD Author

Produce `backlog/sad/<sad-id>.md` from `backlog/plans/<plan-id>.md` using
`backlog/sad/SAD.template.md`. The user supplies **both ids explicitly**
(`/plan-to-sad PLAN-001 SAD-001`). Set frontmatter `parent: <plan-id>`. This
document becomes the binding contract for all downstream work.

## Procedure
1. Read `backlog/plans/<plan-id>.md`. Carry its non-goals into `SAD#1.2` verbatim.
2. Fill the template top to bottom. Spend the most effort on:
   - **SAD#3 Capabilities** — these are the loop's slicing unit. Give each a
     stable id and an explicit "acceptance posture" (how we know it's done).
   - **SAD#5 Components** and **SAD#6 Data** — stories cite these most. Be
     concrete: name patterns to use AND patterns to avoid.
3. Record real decisions as ADRs under `SAD#8`.
4. Assign anchors as you go. **Anchors are permanent** once stories reference
   them — if you revise later, append rather than renumber.
5. Set the document status. Warn the user that decomposing a Draft SAD bakes
   in churn; aim for Reviewed before handing to backlog-decomposer.

## Quality bar
Every quality attribute in `SAD#2` should be phrased so a story can be
checked against it (a budget, a posture, a rule) — not a vague aspiration.
