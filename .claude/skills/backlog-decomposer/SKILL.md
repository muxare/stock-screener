---
name: backlog-decomposer
description: Decompose an approved Software Architecture Document (SAD) into a traceable epic/feature/story backlog grounded in the SAD. Use this whenever the user wants to turn a SAD or architecture doc into work items, create a backlog, break a project into stories, generate epics/features/stories, or slice an architecture into buildable capabilities. Enforces that every story references at least one SAD anchor and is assigned to exactly one capability, so scope stays grounded. Trigger even if the user just says "break this down into stories" while a SAD exists.
---

# Backlog Decomposer

Turn an approved SAD into a backlog of epics → features → stories where
**every story is traceable to the architecture**. The backlog is the bridge
between the SAD (the contract) and the build loop (which slices on
capabilities). Get the traceability right here and scope creep becomes
structurally hard downstream.

## Inputs
- `backlog/sad/<sad-id>.md` — the approved SAD (id passed explicitly via
  `/sad-to-backlog SAD-NNN`). If status is not Approved/Reviewed, warn the user
  before decomposing; decomposing a draft bakes in churn.
- The capability list in `SAD#3` — these become your primary slicing axis.

## The traceability invariant (non-negotiable)

This is the whole point of the skill. Enforce all of these and report any
violation instead of silently fixing it:

1. **Every story has a non-empty `sad_refs`.** A story that can't cite a SAD
   anchor is either out of scope or the SAD is missing something — surface it.
2. **Every `sad_refs` anchor actually exists in the SAD.** Grep the SAD for
   each anchor. A dangling ref is a defect.
3. **Every story has exactly one `capability`**, and that capability id
   exists under `SAD#3`. Stories doing two capabilities get split.
4. **No story builds anything listed in `SAD#1.2` (out of scope).** If one
   does, it's invalid — flag, don't create it.
5. **Every capability in `SAD#3` is covered** by at least one story, OR is
   explicitly deferred with a note. No silent gaps.

After generating, print a coverage table: capability → stories, plus a list
of any invariant violations. Do not claim success while violations remain.

## Procedure

1. Read `backlog/sad/<sad-id>.md`. Extract the capability list (`SAD#3.x`) and
   note the out-of-scope list (`SAD#1.2`) and quality attributes (`SAD#2`).
2. Group capabilities into **features** (a coherent slice of user value) and
   features into **epics** (a major area). Keep the tree shallow. Set
   `sad: <sad-id>` on every epic frontmatter.
3. For each capability, write one or more **stories** using
   `backlog/stories/STORY.template.md`. For each story:
   - Set `capability` to the SAD#3 capability id.
   - Populate `sad_refs` with the specific anchors the implementer must obey
     (prefer SAD#5 components and SAD#6 data rules — they're concrete).
   - Write **acceptance criteria before** any implementation detail, derived
     from the capability's acceptance posture and relevant SAD#2 attributes.
   - Fill **Architectural Constraints** by quoting the obligation from each
     referenced anchor in your own words ("use pattern X per SAD#5.2; do not
     add a second state store").
   - Fill **Out of scope** from SAD#1.2 items that are adjacent and tempting.
   - Fill the **Claude Code Prompt** and **Touch scope** so the story is
     directly runnable by the build loop.
4. Assign `target` only if the user is slicing by named release as well as
   by capability.
5. Run the invariant checks. Emit the coverage table + violations.
6. Present the tree to the user for approval BEFORE writing files, unless
   they've set an autonomy tier that authorizes auto-commit.

## Refinement loop (don't one-shot)

After a first pass, self-critique against the SAD before showing the user:
- Any feature with no SAD section behind it? (Probably invented scope.)
- Any story whose criteria exceed its `sad_refs`? (Drift — tighten or add a
  ref with the user's blessing.)
- Any capability over-decomposed into busywork stories? (Merge.)
Revise, then present.

## ID conventions & story creation
- Create stories with the CLI so they land in `todo/` with a valid skeleton:
  `python tools/board.py new --capability <id> --parent FEAT-007 --title "..."`
  It auto-assigns the next `STORY-NNN` id. Then edit the new file to fill
  `sad_refs`, acceptance criteria, constraints, prompt, and Touch scope.
- Epics/features are plain files under `backlog/epics/` and `backlog/features/`
  using `EPIC.template.md` and `FEAT.template.md` (`EPIC-001`, `FEAT-001`,
  zero-padded, monotonic, never reused). Frontmatter `id` must match filename.
- Parent links: story `parent: FEAT-007`, feature `parent: EPIC-002`.
- After decomposing, run `python tools/board.py validate --sad <sad-id>` to
  confirm tree integrity (orphan links, id formats, SAD traceability).
