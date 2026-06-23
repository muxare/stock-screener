---
description: Author the SAD from the project plan. Usage: /plan-to-sad <plan-id> <sad-id>
---
# /plan-to-sad <plan-id> <sad-id>

Both ids are **required** (e.g. `/plan-to-sad PLAN-001 SAD-001`).

Invoke the **sad-author** skill. Read `backlog/plans/<plan-id>.md` and produce
`backlog/sad/<sad-id>.md` from `backlog/sad/SAD.template.md` with
`parent: <plan-id>`. Assign stable anchors. Carry the plan's non-goals into
SAD#1.2. Aim for Reviewed status before backlog decomposition.
