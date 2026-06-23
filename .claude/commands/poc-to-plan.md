---
description: Reverse-engineer a proof-of-concept into a structured project plan. Usage: /poc-to-plan [poc-path] <plan-id>
---
# /poc-to-plan [poc-path] <plan-id>

The `<plan-id>` is **required** (e.g. `/poc-to-plan poc/ PLAN-001`). The POC
path defaults to `poc/` if omitted.

Invoke the **poc-to-plan** skill. Inventory the POC, extract the capabilities
it already proves, and write `backlog/plans/<plan-id>.md` from
`backlog/plans/PLAN.template.md` with `parent: <poc-source>` and
`source_kind: poc`. Sort every POC decision into Keep / Replace / Decide-later:
the "Replace" pile must surface as Non-goals or Constraints, never as silent
requirements. Hand the result to `/plan-to-sad <plan-id> SAD-NNN` next.
