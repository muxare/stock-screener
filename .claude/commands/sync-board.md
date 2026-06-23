---
description: Sync the local backlog with Azure DevOps / GitHub via MCP. Usage: /sync-board [push|pull]
---
# /sync-board [push|pull]
Invoke the **story-syncer** skill. Default to `python tools/sync_board.py status`
and a dry-run summary if no direction given. Use `sync_board.py push|pull`
(with `--dry-run` first) for the file-backed stub; delegate to MCP connectors
when present. Honor the conflict rule (remote column wins, local body wins).
