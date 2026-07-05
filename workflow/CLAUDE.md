# CLAUDE.md — the workflow system

This directory is a **one-human-plus-agents Scrum system** layered over the
`backlog/`. It exists so many agents can plan and build safely without a human
watching every step. Read this before running a ceremony, editing a lens, or
mutating the board. (Project/app basics are in the root `CLAUDE.md`.)

## Golden invariants (do not break)
1. **The board is mutated only through `python3 workflow/tools/board.py`.** Hooks
   block manual `mv`/edits of `backlog/board/`. Disk (folders + frontmatter) is the
   source of truth; `board.md` / `index.html` are *generated views*.
2. **Agents prepare; the human decides at a gate.** The planning/retro lenses are
   **read-only** — they run only *read* `board.py` subcommands and never move/set/
   commit or edit files.
3. **Never invent scope.** Every committed story must already be a traceable,
   SAD-anchored todo. New scope is *captured* as an IDEA for Vision-gate triage —
   **capture ≠ commit**. The idea inbox is firewalled from `backlog/board/`.
4. **Everything routes to a gate.** No orphan prose; each recommendation names the
   gate it feeds.

## The gates
- **Vision** — human triages ideas/plans into a SAD-anchored roadmap (`idea-new`/`idea-list`).
- **Architecture** — a governing SAD must be Approved before its work is fully trusted.
- **Commit** — the human commits a sprint: `board.py sprint-plan-new` (one active at a time).
- **Acceptance / Review** — a story reaches `review`→`done`; the **R-1 code-review
  gate** (`review-record`) and the review-check gate are enforced on the move.
- **Exception** — blocked work needing a human (`board.py exceptions`).

## Hierarchy & key artifacts
- `backlog/epics/` → `backlog/features/` → `backlog/board/{todo,in-progress,review,done,blocked}/STORY-*.md`,
  all anchored to `backlog/sad/SAD-*.md` capabilities (SAD#3) and success metrics (SAD#1).
- `backlog/tech-health.md` — the standing tech-debt/hotspot register (Dev-team lens).
- `backlog/deferred-capabilities.md` — capabilities consciously parked (not gaps).
- `backlog/.workflow/events.jsonl` — telemetry behind `board.py metrics`.

## The planning/retro panel (read-only lenses, `workflow/agents/`)
Convened concurrently by `/sprint-plan` and `/sprint-retro`; each stays in its lane,
they don't see each other's output, and the command synthesises one proposal:
- **product-owner-lens** — the product **vision** on two horizons: a **long plan**
  (roadmap across epics/features, ladder-up check) + a **short plan** (sprint goal,
  value-ordered todos, Definition-of-Ready).
- **dev-team-lens** — engineering reality: feasibility, sizing, coupling read, rework
  risk, enabler/techdebt nominations; reads & recommends updates to `tech-health.md`.
- **scrum-master-lens** (flipped) — the **parallelization architect**: which todos
  run as concurrent worktree agents vs a serialized spine, split-for-parallelism
  recommendations, and **WIP as a safe-parallelism ceiling** (integration + review
  bandwidth, not throughput).
- **claude-code-leverage** — turns the SM's parallelization map into execution
  mechanics (worktrees, tiers, reviewer fan-out, SDK/Batch for bulk lanes) + tooling
  investment that compounds.

Pipeline at planning: **dev-team** (coupling read) → **scrum-master** (parallelization
map) → **claude-code-leverage** (mechanics); **PO** frames value/vision across it all.

## Ceremonies & the build loop
- `/sprint-plan [cap]` — prepare a sprint proposal (human commits at the Commit gate).
- `/build-toward <capability> [tier]` — the execution loop inside the committed sprint.
- `/sprint-retro` — retro a closed sprint; proposals route to a gate.
- **Autonomy tiers A1/A2/A3** (`workflow/docs/autonomy-tiers.md`) — **A2 is default**:
  agents implement to green + review-check and stop at `review`; the human accepts
  (`move done`) or rejects. **Review-check is mandatory at every tier.**

## Deeper docs
`workflow/docs/sprint-ceremonies.md` (ceremony detail), `autonomy-tiers.md` (the
build loop contract), `work-process-analysis.md` (design rationale),
`claude-code-api-leverage.md`. The lens prompts themselves live in `workflow/agents/`.
