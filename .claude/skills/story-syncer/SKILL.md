---
name: story-syncer
description: Sync the local markdown backlog with Azure DevOps and/or GitHub work items via MCP, bidirectionally. Use when the user wants to push stories to Azure DevOps or GitHub, pull status back, mirror the board to a tracker, or keep the repo backlog and the remote tracker in sync. Trigger on "sync to DevOps", "push these to GitHub issues", "update the board from the tracker", or mentions of Azure DevOps / GitHub work items alongside the local backlog. Degrades gracefully: if no MCP is connected, says so and leaves the local files as the source of truth.
---

# Story Syncer

The local `backlog/**/*.md` files are the source of truth. This skill mirrors
them to a remote tracker via MCP and pulls status back. It is a sync layer,
not the backbone — if no connector is present, the system still works locally.

## CLI stub (always available)

Run the deterministic sync helper before or instead of MCP calls:

```bash
python tools/sync_board.py push [--dry-run]     # local → .sync/remote-state.json
python tools/sync_board.py pull [--dry-run]     # remote column → board.py move
python tools/sync_board.py status
```

- **Default backend:** file mirror at `.sync/remote-state.json` (for dry-run,
  testing, and MCP handoff). Real MCP connectors should translate API results
  to the same `RemoteRecord` shape and reuse `plan_push` / `plan_pull` logic.
- **Never push** stories with empty `sad_refs` — fix the backlog first.
- **Pull column changes** only via `python tools/board.py move <id> <column>`.

## Connectors
- **Azure DevOps MCP** — work items (Epic/Feature/Story types, board columns).
- **GitHub MCP** — issues + projects (labels/columns).
If neither is connected, run `sync_board.py` in `--dry-run` mode, report that
no live connector is present, and leave local files as source of truth.

## Field mapping
| Local source      | Azure DevOps        | GitHub                  |
|-------------------|---------------------|-------------------------|
| `type`            | Work Item Type      | label `type:*`          |
| `parent`          | parent link         | task-list / `parent:` ref |
| board folder (column) | board column / State | project column / state |
| `capability`      | tag `cap:<id>`      | label `cap:<id>`        |
| `target`          | tag / iteration     | milestone               |
| `id`              | stored in a custom field or the title prefix to re-match on pull |

Read a story's column from its folder under `backlog/board/<column>/` (use
`python tools/board.py list --json`), not from frontmatter — there is no
`status` field. On pull, translate a remote column change into a
`python tools/board.py move <id> <column>` so the legal-move rules still apply.

## Push (local → remote)
1. Run `python tools/board.py validate` — abort if violations.
2. `python tools/sync_board.py push` (or MCP equivalent updating remote API).
3. For each story, find the remote item by stored `id`. Create if missing,
   update if present. Map fields per the table.

## Pull (remote → local)
1. Fetch remote state (MCP) or read `.sync/remote-state.json` (stub).
2. `python tools/sync_board.py pull [--dry-run]` to preview/applies column moves.
3. **Conflict rule:** remote `column` wins; local story body/criteria win.
   Report conflicts instead of overwriting markdown bodies.

Always print a summary: created / updated / skipped / conflicts.
