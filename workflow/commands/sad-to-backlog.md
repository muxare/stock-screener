---
description: Decompose the approved SAD into a traceable backlog. Usage: /sad-to-backlog <sad-id>
---
# /sad-to-backlog <sad-id>

The SAD id is **required** (e.g. `/sad-to-backlog SAD-001`).

Invoke the **backlog-decomposer** skill against `backlog/sad/<sad-id>.md`.
Produce epics/features/stories under `backlog/`. Set `sad: <sad-id>` on every
epic. Enforce the traceability invariant (every story references a real SAD
anchor and exactly one capability). Print the coverage table + any violations
before writing files. After writing, run
`python workflow/tools/board.py validate --sad <sad-id>`.
