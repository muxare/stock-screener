---
description: Refine a raw project idea into a structured project plan. Usage: /refine-idea <idea-id> <plan-id>
---
# /refine-idea <idea-id> <plan-id>

Both ids are **required** (e.g. `/refine-idea IDEA-001 PLAN-001`).

Invoke the **idea-refiner** skill. Read `backlog/ideas/<idea-id>.md` (or the
user's inline text if they are creating the idea in the same turn). Write
`backlog/plans/<plan-id>.md` with `parent: <idea-id>`. Pay special attention
to the non-goals section — it is the first scope gate.
