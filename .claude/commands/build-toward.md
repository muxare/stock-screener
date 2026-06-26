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

## Gate 3 — the active batch (commit before you build)
The committed slice is recorded as a **batch** — the Gate-3 prioritisation
checkpoint. Before looping, read it: `python tools/board.py batch-list`.
- The `<selector>` should name a capability **inside the active batch's
  `capabilities`**. Building outside the committed batch is a Gate-3 decision —
  surface it to the human, don't widen scope yourself.
- The active batch sets the **WIP limit** (`wip_limit`). `move in-progress`
  prints a WIP warning past the limit and `board.py validate` flags a breach —
  when WIP is full, finish or defer a story rather than starting another.
- No active batch? Ask the human to commit one
  (`board.py batch-new --capabilities … --goal … [--wip N]`) before a bulk run;
  the default WIP limit applies until then.

## Autonomy tier (default A2)
- **A2 (default)** — implement matching stories automatically and commit per
  story *without* per-commit human confirmation, then pause at `review` (don't
  sync, don't close). The human acts only at the review gate (accept or reject).
- **A1** — decompose/propose only or stop after one story; confirm with the
  human before each commit. Reserve for when architecture or scope is still
  settling.
- **A3** — implement to green tests, set `review`, then sync via story-syncer.
Map these to the user's A1/A2/A3 conventions if they have them. See
`docs/autonomy-tiers.md` for checkpoints and review-check requirements.
The Phase-1 gates still apply at every tier: the hard review-check gate runs on
`move review`/`move done` and refuses on problems — A2 drops per-commit
confirmation, not the review gate.

## Loop (driven entirely through tools/board.py)
```
# the slice = stories matching the selector, in startable columns
stories = board.py list --capability <selector> --json   (fall back to --target)
          filter to column in {todo, in-progress}
order by parent/dependency, then id
for story in stories:
    board.py move <id> in-progress          # refused if sad_refs empty; stamps attempts;
                                            # stamps base_commit=HEAD on FIRST entry only
    if story has a reject_reason:           # bounced at Gate 4 — rework brief
        read it and address that feedback FIRST (it clears on next move review)
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

**Same defect class, next door.** When the same root cause appears in a sibling
spot the AC didn't name (the identical race one function away, the same missing
guard in a peer handler), apply one rule — no judgement wobble:

> **Same root cause AND inside this story's Touch scope ⇒ fix it now** and note
> the widening in the commit body (which sibling, why it's the same cause).
> **Otherwise ⇒ fan a new story** (different root cause, or the fix lands outside
> Touch scope). Don't quietly edit outside scope — the review-check gate refuses
> it anyway.

The test is mechanical: *same cause* and *in Touch scope* are both yes → fix and
document; any no → fan out. This keeps "obviously the same bug" from forcing a
second round-trip while still stopping silent scope expansion.

## Gate 4 — acceptance (human)
A story that reaches `review` waits for the human. Two sanctioned outcomes:
- **Accept:** `board.py move <id> done` (re-runs the gate; refused on problems).
- **Reject:** `board.py reject <id> --reason "<rework brief>"` — bounces the
  story `review → in-progress` and stamps `reject_reason`. Because the loop
  picks `{todo, in-progress}`, the rejected story **re-enters automatically** —
  no manual demote (closes friction F9). On re-entry the loop reads
  `reject_reason` first and addresses that feedback before re-running the gate.

## Termination report
Print: done / review / blocked per story, plus any flagged SAD conflicts that
need a human decision (likely a new ADR in `SAD#8`). Then run
`python tools/board.py exceptions` — every story you blocked lands in the
**Gate 2/5 queue**, split into "needs a human decision" (ADR / vendor / legal)
vs ordinary process blocks. That queue is the single surface the human (or the
Scrum-Master lens) reads; you do not need to chase blocked items yourself.
