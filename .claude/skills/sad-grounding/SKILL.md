---
name: sad-grounding
description: Ground any implementation work in the project's Software Architecture Document (SAD) so code matches the agreed architecture and scope stays contained. Use this whenever implementing a story, working a backlog item, writing code against an architecture doc, or running the build loop. Trigger whenever a task references a story file, a SAD anchor (like SAD#5.2), a `sad_refs` field, or asks to "implement", "build", or "work" a story. This is the runtime guardrail that keeps implementation from drifting beyond the architecture or quietly expanding scope.
---

# SAD Grounding

The SAD (`backlog/sad/SAD-NNN.md`) is the binding architectural contract.
Resolve which file to open from the story's parent epic (`sad: SAD-NNN` on the
epic frontmatter), or ask the user for the id if ambiguous. This skill keeps
implementation faithful to it and stops the classic agentic failure modes: drifting past the architecture, gilding features, and passing tests by
weakening them.

## Before writing any code

1. Read the story file. Note its `sad_refs`, acceptance criteria, **Out of
   scope**, and **Touch scope**.
2. Open `backlog/sad/<sad-id>.md` and read ONLY the sections named in
   `sad_refs` (plus any anchors those sections explicitly point to). Don't
   free-read the whole SAD — read the cited contract.
3. **Restate the binding constraints back** in one short block before coding:
   what each referenced anchor obligates and forbids. This is your check that
   you actually loaded the contract, and it makes drift visible to the user.

## While implementing

- Touch only paths in **Touch scope**. Needing a file outside it is a signal:
  either the story is mis-scoped or you're drifting. Stop and flag.
- Build only what the acceptance criteria require. If you feel the urge to add
  "just one more" convenience — that's scope creep. Don't.
- If a requirement **conflicts with the SAD**, STOP. Do not resolve it by
  improvising a new architecture. Report the conflict with both sides quoted
  and let the human decide (it may mean the SAD needs an ADR).

## Verifying (anti-cheat)

- Check each acceptance criterion explicitly; tick the boxes you actually met
  via `python tools/board.py check <id> --criterion "<substring>"` (the edit
  guard blocks flipping checkboxes by hand on an active story).
- Do NOT weaken or delete tests to make them pass. A failing test that
  reflects a real criterion stays failing and gets reported.
- If you couldn't satisfy a criterion within scope, say so plainly and move the
  story to `blocked` with a reason. Honest blockage beats a green check that lies.

## Review gate checklist (required before `review` or `done`)

Complete every step and **show the output** in the transcript. Do not skip or
summarize — the user must be able to audit the gate.

1. **Base commit is auto-stamped.** `move in-progress` records `base_commit=HEAD`
   on the story's FIRST entry (bounces keep the original pre-story base), so the
   gate diffs only this story's changes. No manual capture needed; you may still
   override with `--base <ref>` on review-check/move.
2. **Run a code-review pass** after tests are green and criteria are ticked,
   BEFORE moving to review: run `/code-review` (or spawn a code-review agent) on
   the story diff vs `base_commit`. Address blocking findings; fan out-of-scope
   findings into new stories. This is a mandatory loop step (it catches the
   defect class review-check's heuristics miss — the STORY-018 lesson).
3. **Pre-flight inspect (optional):** `python tools/board.py review-check <id>`
   and paste the stdout. This is now an inspection, not the enforced gate.
4. **Move to review:** `python tools/board.py move <id> review`. The move
   **automatically re-runs the review-check gate** against `base_commit` and is
   **refused** if it finds problems (so the gate no longer depends on you
   remembering to run it). Human-only override: `move --skip-review-check`
   (logged to events.jsonl as an `override`). If the story has no `base_commit`
   the move is refused — re-run `move in-progress` or pass `--base`.
5. **Move to done** only after human review (or tier A3 policy) and with all
   acceptance boxes `[x]`: `python tools/board.py move <id> done` — this also
   re-runs the gate.

Hooks block manual `mv`/`rm` of story files; column changes through `board.py`
only. The gate verifies acceptance criteria, Touch scope, and test integrity
(deletions, count regression, weakened assertions).

## State is the folder, not your head, and you change it ONLY via board.py

The board is a folder structure (`backlog/board/<column>/`). A story's column
IS its status. **Never `mv` a story file or edit its column by hand** — always
go through the CLI, which enforces legal transitions and the invariants:

- `python tools/board.py move <id> in-progress`  — start work (refused if
  `sad_refs` is empty; stamps `attempts`).
- `python tools/board.py move <id> review`        — hand off for review.
- `python tools/board.py move <id> done`          — refused while any
  acceptance-criteria box is unchecked, so you can't close a lying story.
- `python tools/board.py move <id> blocked --reason "<why>"` — on a SAD
  conflict or max attempts; remembers the origin column.
- `python tools/board.py move <id> unblock`       — returns it where it came from.

On an **active** story (in-progress/review/done/blocked) the edit guard blocks
direct edits that flip a criterion checkbox or touch protected frontmatter, so
change those through the CLI:

- `python tools/board.py check <id> --criterion "<substring>"` — tick a
  criterion (`--all` for every one, `--uncheck` to clear).
- `python tools/board.py set <id> <field> <value>` — set an allowlisted field
  (sad_refs, capability, target, estimate, parent; NOT base_commit/attempts/column).

Free-text body edits (notes, Decisions, blocked_reason prose) and ALL edits while
the story is in `todo` (authoring) stay allowed. Column changes always go through
`board.py` so the rules can't be bypassed.
