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
    board.py move <id> in-progress          # refused if sad_refs empty; stamps attempts;
                                            # stamps base_commit=HEAD on FIRST entry only
    -> invoke sad-grounding: read sad_refs sections, restate constraints
    implement within Touch scope only
    run tests / check acceptance criteria; tick met boxes via board.py check (NOT by editing the file)
        board.py check <id> --criterion "<substring>"   # ticks the matching criterion
    if all criteria pass and tests green:
        # MANDATORY code-review pass (loop discipline, not enforced by board.py):
        run /code-review (or spawn a code-review agent) on the story diff vs base_commit
        address blocking findings; fan out-of-scope findings into new stories (existing pattern)
        board.py review-check <id>            # pre-flight inspection (optional --base override)
        board.py move <id> review            # the move RE-RUNS the review-check gate and
                                             # REFUSES if it finds problems; (A3: then syncer push)
                                             # human override: move --skip-review-check (logged)
        if move refused:
            fix the flagged scope/test issues, or
            board.py move <id> blocked --reason "review-check: <summary>"
        # move review/done also refuses while any criterion box is unchecked,
        # or if the story has no base_commit (re-run move in-progress, or pass --base)
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
sanctioned mutation path, which is what makes the board deterministic. Story-file
mutations on **active** stories (in-progress/review/done/blocked) also go through
the CLI: tick acceptance criteria via `board.py check <id> --criterion "…"` and
change allowlisted frontmatter (sad_refs, capability, target, estimate, parent)
via `board.py set <id> <field> <value>`. The edit guard hook blocks direct
`Edit`/`Write` that flips a criterion checkbox or touches protected frontmatter
on an active story; free-text body edits (notes, Decisions) stay allowed.

**The base commit is stamped automatically** as `base_commit` on the first
`move in-progress` (bounces keep the original pre-story base), so `move review`/
`move done` runs the review-check gate against the right diff without you tracking
it by hand. You can still inspect it (`git rev-parse HEAD`) and override the gate's
base with `review-check --base <ref>` / `move --base <ref>`. The gate runs
**automatically on the move** to review or done and refuses on problems; the human
override is `move --skip-review-check` (logged to events.jsonl as an `override`).
Running `board.py review-check` by hand beforehand is now a **pre-flight
inspection**, not the enforced gate. The check verifies acceptance criteria,
Touch scope, and test integrity (deleted tests, count regression, weakened
assertions). Follow the **Review gate checklist** in `sad-grounding`.

## Scope firewall
Stories whose `capability`/`target` don't match the selector are invisible to
this run. That's the feature: to build more, flip a story into the slice
deliberately. The loop never widens its own scope.

## Termination report
Print: done / review / blocked per story, plus any flagged SAD conflicts that
need a human decision (likely a new ADR in `SAD#8`).
