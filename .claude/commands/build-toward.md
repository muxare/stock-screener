---
description: Run the build loop over a slice of the backlog (a capability or a named target), grounded in the SAD. Usage: /build-toward <selector> [tier=A1|A2|A3]
---

# /build-toward <selector> [tier]

Iterate over open stories matching `<selector>` and implement them, grounded
in the SAD, until the slice is green or blocked. The `sad-grounding` skill
fires on each story.

`<selector>` matches a story's `capability` id OR its `target`. Try capability
first, fall back to target. The selector is generic on purpose — the
vocabulary lives in the data, not this command.

## Autonomy tier (default A1)
- **A1** — decompose/propose only or stop after one story; confirm with the
  human before each commit.
- **A2** — implement matching stories automatically, but pause at `review`
  (don't sync, don't close).
- **A3** — implement to green tests, set `review`, then sync via story-syncer.
Map these to the user's A1/A2/A3 conventions if they have them. See
`docs/autonomy-tiers.md` for checkpoints and review-check requirements.

## Loop (driven entirely through tools/board.py)
```
# the slice = stories matching the selector, in startable columns
stories = board.py list --capability <selector> --json   (fall back to --target)
          filter to column in {todo, in-progress}
order by parent/dependency, then id
for story in stories:
    board.py move <id> in-progress          # refused if sad_refs empty; stamps attempts
    -> invoke sad-grounding: read sad_refs sections, restate constraints
    implement within Touch scope only
    run tests / check acceptance criteria; tick the boxes you truly met
    if all criteria pass and tests green:
        board.py review-check <id> --base <pre-story commit>   # anti-cheat gate
        if review-check passes:
            board.py move <id> review            # (A3: then story-syncer push)
        else:
            fix the flagged scope/test issues, or
            board.py move <id> blocked --reason "review-check: <summary>"
        # board.py also refuses `done` while any criterion box is unchecked
    elif scope/SAD conflict detected:
        board.py move <id> blocked --reason "<conflict>"   # STOP this story, flag
    elif attempts >= MAX (default 3):
        board.py move <id> blocked --reason "max attempts"
    else:
        retry within scope
stop when no matching {todo,in-progress} stories remain
run board.py validate --sad <sad-id> at the end (resolve sad-id from the
epic `sad` field on stories in this slice; ask if multiple)
```
Never edit a story's column by hand or `mv` files — the CLI is the only
sanctioned mutation path, which is what makes the board deterministic.

**Capture the base commit before starting each story** (e.g. `git rev-parse HEAD`)
so `review-check --base <that>` diffs only this story's changes. Follow the
**Review gate checklist** in `sad-grounding`: paste `git rev-parse` output and
full `review-check` stdout before `move review`. The check verifies Touch scope
and test integrity (deleted tests, count regression, weakened assertions).

## Scope firewall
Stories whose `capability`/`target` don't match the selector are invisible to
this run. That's the feature: to build more, flip a story into the slice
deliberately. The loop never widens its own scope.

## Termination report
Print: done / review / blocked per story, plus any flagged SAD conflicts that
need a human decision (likely a new ADR in `SAD#8`).
