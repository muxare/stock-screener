# Idea — Local backlog visualizer

A **read-only**, local-only kanban view of the sad-wf board. Scan
`backlog/board/{todo,in-progress,review,done,blocked}/STORY-*.md`, parse
frontmatter, and serve a simple HTML page with one column per folder. Each card
shows story id, capability, `sad_refs`, blocked reason (if any), and acceptance-
criteria progress (e.g. `2/3` checked). Refresh on a timer or via a button —
never mutate board files from the UI.

Designed to run **inside a sad-wf repo** (alongside `workflow/tools/board.py`), e.g.
`python tools/board_viz.py serve --port 8765` bound to `127.0.0.1` only.

## Seed non-goals (for refine-idea)
- No drag-and-drop or click-to-move — column changes stay on `board.py move`.
- No binding to `0.0.0.0` or TLS; localhost only.
- No Azure DevOps / GitHub sync UI or remote backlog sources.
- No epic/feature tree or SAD document viewer in v1 (board columns only).
- No authentication — trust the local machine.

## Why this idea fits sad-wf
Meta-dogfood: the visualizer consumes the same folder-is-state model the
workflow enforces. Exercises **read-only boundaries** (must not bypass hooks),
frontmatter parsing shared with `board.py`, and clear non-goals around mutation.
Complements `board.py render` (Markdown list) with an at-a-glance kanban.

## Rough capabilities (hint for SAD#3)
- `board.scan` — list stories per column, parse frontmatter + criteria counts
- `viz.render` — build column/card HTML (or JSON for a thin client)
- `server.local` — HTTP on 127.0.0.1, graceful shutdown, no write routes
- `cli.serve` — port, refresh interval, optional `--capability` filter
