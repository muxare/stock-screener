---
id: FEAT-000
type: feature
parent: EPIC-000           # REQUIRED — must match an existing EPIC-NNN.md
sad_refs: SAD#3.1
capabilities: <cap-id>     # one or more SAD#3 capabilities this feature builds
---

# FEAT-000 — <Feature title>

Coherent user-value slice rolling up to the parent epic.

## Parent
EPIC-000

## Capabilities covered
- `<cap-id>` (SAD#3.x) — stories use `parent: FEAT-000` and this capability id.

## Notes
- Create stories via `python workflow/tools/board.py new --capability <id> --parent FEAT-000`.
