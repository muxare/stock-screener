# `workflow/` — the SAD-grounded workflow engine

A portable pipeline that takes a project idea → project plan → **SAD** →
traceable backlog → kanban → SAD-grounded implementation loop. The SAD is the
binding contract; everything downstream references it by anchor, which is what
keeps scope from creeping.

```
IDEA-NNN → /refine-idea IDEA PLAN → PLAN-NNN → /plan-to-sad PLAN SAD → SAD-NNN ──┐
   (or /poc-to-plan poc/ PLAN for a POC-first start)                              │
SAD-NNN → /sad-to-backlog SAD → epics/features/stories  ──────────────────────────┤
                                                                                  │
/sprint-plan → Commit gate → /build-toward <capability|target> [tier] ────────────┘
        ↑ scope firewall: only matching stories in the active batch are visible
/sprint-retro [BATCH-NNN]   → workflow-change proposals
/sync-board [push|pull]     ←→ Azure DevOps / GitHub (MCP, optional)
```

This is the engine, kept as one liftable folder. It is the source of truth for
the workflow tooling; `.claude/{commands,skills,agents}` are **symlinks** into
here so Claude Code can discover them, and `.claude/settings.json` points its
hooks at `workflow/hooks/`.

## Layout

```
workflow/
├── tools/      board.py (the only sanctioned board mutator), workflow_log.py,
│               sync_board.py, install_check.py, tests/
├── hooks/      the 4 Claude Code hooks (guard, log, session-ground, localhost-curl)
├── commands/   slash commands (source of truth; .claude/commands → here)
├── skills/     skills          (source of truth; .claude/skills   → here)
├── agents/     subagents        (source of truth; .claude/agents  → here)
├── docs/       work-process-analysis, ceremonies, autonomy-tiers, friction, ideas/
└── README.md   (this file)
```

Project **data** the engine produces lives under `backlog/` at the repo root
(board columns, ideas, plans, sad, epics, features, batches, retros, stories,
the `*.template.md` seeds, and `.workflow/events.jsonl`). The engine folder holds
no project data — that separation is what makes `workflow/` liftable.

## Root resolution (the one load-bearing detail)

All four tools locate the repo (and therefore `backlog/`) through
`workflow_log.project_root()`, in this order:

1. `$CLAUDE_PROJECT_DIR` (set by Claude Code)
2. `$SAD_WF_ROOT` (manual override for plain terminals / CI)
3. upward search from cwd for a `backlog/` marker, else a `__file__`-based climb

So the tools work both inside Claude Code and from a bare shell, and stay correct
no matter where `workflow/` sits, as long as `backlog/` is at the resolved root.

## The board is deterministic by construction
- A story's **column is its folder** under `backlog/board/`. No `status:` field to
  parse — the structure *is* the state, and `git` records column changes as file
  renames (free board history).
- All mutations go through `python workflow/tools/board.py`:
  - `new` · `move <id> <column>` · `list [--json]` · `show <id>` · `check` · `set`
  - `review-check <id>` · `render` (→ `backlog/board.md`) · `render-html`
    (→ `backlog/index.html`) · `validate [--sad SAD-NNN]` · `logs` · `metrics`
- **Enforced rules:** no forward skips (todo→in-progress→review→done), back-moves
  allowed, can't `in-progress` with empty `sad_refs`, can't reach `done` with
  unchecked acceptance criteria, `blocked` remembers its origin. `move in-progress`
  auto-stamps `base_commit`; `move review`/`done` re-run the review-check gate.

## Hooks (`workflow/hooks/`, wired in `.claude/settings.json`)
- `guard_board_mutation.py` — blocks manual story-file moves and direct edits to
  criteria/protected frontmatter on **active** stories (todo authoring stays free).
- `log_backlog_interaction.py` — appends every board interaction to
  `backlog/.workflow/events.jsonl` (the audit trail).
- `session_ground.py` — SessionStart re-grounding: prints where the workflow is.
- `allow_localhost_curl.py` — dev convenience (auto-allows localhost curls).

## Install into a project
1. Drop `workflow/` at the repo root and create the data root `backlog/` (column
   folders + the `*.template.md` seeds).
2. Symlink discovery: `.claude/commands → ../workflow/commands`,
   `.claude/skills → ../workflow/skills`, `.claude/agents → ../workflow/agents`.
3. Point `.claude/settings.json` hooks at `$CLAUDE_PROJECT_DIR/workflow/hooks/*.py`.
4. Verify: `python3 workflow/tools/install_check.py` and
   `python3 workflow/tools/board.py validate`.

Everything is files-in-repo, so it's portable and works with no MCP connected;
the MCP sync layer (`/sync-board`) is optional.
