# Autonomy tiers (A1 / A2 / A3)

The build loop (`/build-toward <capability> [tier]`) controls how much an agent
may do without human confirmation. **A2 is the default tier.** **Review-check is
mandatory at every tier** before a story reaches `review` or `done`.

## Tier summary

| Tier | Implements | Commits | Stops at | Human must |
|------|------------|---------|----------|------------|
| **A1** | Proposes or one story at a time | Every commit confirmed | After each story or step | Approve plan, commits, review |
| **A2 (default)** | Full story implementation | Auto per story (no per-commit confirm) | **`review` column** | Accept (`move done`) or `reject`, resolve conflicts |
| **A3** | Full story to green + review-check | Auto per story | After **`review`** (+ optional sync) | Final `done` unless policy allows |

Map these labels to your team's conventions if you use different names — the
**checkpoints below are the contract**.

---

## Mandatory checkpoints (all tiers)

Before **`move review`** for any story:

1. **base_commit** is auto-stamped on the first `move in-progress` (bounces keep
   the original pre-story base); no manual capture needed
2. Implement within **Touch scope** only; tick met acceptance criteria via
   `python tools/board.py check <id> --criterion "…"` (the edit guard blocks
   flipping checkboxes by hand on an active story)
3. Run tests; failures block the gate
4. **Run a code-review pass** on the story diff vs `base_commit` (the
   `/code-review` skill or a code-review agent); address blocking findings, fan
   out-of-scope findings into new stories — mandatory loop step, not enforced by
   board.py
5. Optionally pre-flight `python tools/board.py review-check <id>` and paste the
   stdout (inspection only — see `sad-grounding` skill)
6. `python tools/board.py move <id> review` — the move **automatically re-runs
   the review-check gate** against `base_commit` and is **refused** on problems;
   human-only override is `move --skip-review-check` (logged as an `override`)

Before **`move done`**:

1. All acceptance criteria `[x]` (board.py refuses otherwise)
2. Human review completed (A1/A2) or explicit A3 policy documented in repo
3. `move done` also re-runs the review-check gate (same `--skip-review-check`
   override applies)
4. Column change via `board.py` only (hooks block manual `mv`)

---

## A1 — Propose and confirm

Opt-in (no longer the default). Use when architecture or scope is still settling.

- Agent **restates SAD constraints** and proposed diff before coding.
- **One story** (or one commit) at a time unless the user widens scope.
- Agent **does not commit** without explicit user approval.
- Agent **does not** `move review` or `move done` without user saying so after
  seeing review-check output.

---

## A2 — Implement, pause at review (default)

The default: autonomous implementation, human merge gate.

- Agent runs the full story loop through tests green + **review-check pass**.
- Agent **commits per story without per-commit human confirmation.**
- Agent **`move review`** automatically when the gate passes.
- Agent **stops** — does not `move done`, does not sync to remote unless asked.
- Human reviews the diff and either accepts (`python tools/board.py move <id>
  done`) or rejects (`python tools/board.py reject <id> --reason "…"`), which
  auto-returns the story to `in-progress` so the loop re-picks it.

---

## A3 — Implement to review (+ optional sync)

Use when CI and review-check gates are trusted and humans batch-review.

- Same gates as A2 through **review-check** and `move review`.
- Agent may run **`/sync-board push`** after `review` if MCP is configured.
- Agent **does not** `move done` unless the repo documents an explicit A3
  auto-close policy (most repos should still require human `done`).

---

## When things fail

| Situation | Action |
|-----------|--------|
| review-check fails | Fix scope/tests or `move blocked --reason "review-check: …"` |
| Human rejects at review | `board.py reject <id> --reason "…"` — auto-returns to in-progress; loop re-picks it |
| SAD conflict | STOP, flag for ADR; do not improvise architecture |
| Max attempts (default 3) | `move blocked --reason "max attempts"` |
| Illegal board transition | Use legal path (no forward skips); never `mv` files |

---

## Related commands

```bash
python tools/board.py list --capability <id> --json
python tools/board.py review-check STORY-NNN --base <commit>
python tools/board.py reject STORY-NNN --reason "…"   # Gate-4 reject -> back to in-progress
python tools/sync_board.py push --dry-run    # optional, after review in A3
```

See also: `sad-grounding` skill (Review gate checklist), `build-toward` command.
