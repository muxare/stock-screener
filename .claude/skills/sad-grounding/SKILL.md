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

- Check each acceptance criterion explicitly; tick the boxes you actually met.
- Do NOT weaken or delete tests to make them pass. A failing test that
  reflects a real criterion stays failing and gets reported.
- If you couldn't satisfy a criterion within scope, say so plainly and move the
  story to `blocked` with a reason. Honest blockage beats a green check that lies.

## Review gate checklist (required before `review` or `done`)

Complete every step and **show the output** in the transcript. Do not skip or
summarize — the user must be able to audit the gate.

1. **Capture base commit** before `move in-progress`:
   `git rev-parse HEAD` → record as `<base>`.
2. **Run review-check** after tests are green and criteria are ticked:
   `python tools/board.py review-check <id> --base <base>`
   Paste the full stdout. **Stop if exit code is non-zero** — fix or
   `move blocked --reason "review-check: …"`.
3. **Move to review** only after review-check passes:
   `python tools/board.py move <id> review`
4. **Move to done** only after human review (or tier A3 policy) and with all
   acceptance boxes `[x]`:
   `python tools/board.py move <id> done`

Hooks block manual `mv`/`rm` of story files; column changes through `board.py`
only. `review-check` verifies Touch scope and test integrity (deletions,
count regression, weakened assertions).

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

Edit `blocked_reason`/criteria checkboxes in the file as needed, but column
changes happen through `board.py` so the rules can't be bypassed.
