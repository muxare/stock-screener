# Backlog refinement & consolidation — the `/refine` ceremony

_Status: **PROPOSED** (design, not landed). Routes to the **Vision gate** as an
IDEA (a process/tooling change has no product `sad_refs`, so capture≠commit forces
it through Vision — see `workflow/CLAUDE.md` §"The gates"). Nothing here mutates
the board; it is a design artifact in the lineage of
`workflow/docs/sprint-ceremonies.md` and `work-process-analysis.md`._

_Builds on: the four read-only lenses (`workflow/agents/`), the Scrum-Master lens's
**parallelization map** and **split-for-parallelism** heuristics, the
`backlog-decomposer` skill, and the `EPIC→FEAT→STORY` hierarchy (`board.py new`,
`set parent`)._

---

## 0. The idea in one paragraph

A **refinement** is a standing ceremony that reshapes the **backlog itself** — it
**creates, splits, combines, and retires** stories so the backlog stays *current*
and so the **largest possible number of Ready stories can run as concurrent agents
in isolated worktrees**. It reuses the planning roster (PO + Scrum-Master +
Dev-team) but is a *different lifecycle object* from planning and retro: planning
changes **the commitment**, retro changes **the process**, refinement changes **the
shape of the backlog**. Like the others it is **prep, not a decision**: the lenses
are read-only and emit a **change-set proposal**; the human applies it through
`board.py`. **No sixth gate** — every output lands at an existing gate (new
SAD-anchored work → Commit gate; new scope/theme → Vision gate as an IDEA; a
verified parallel lane set → a **fan-out FEAT** the build loop can run). The
load-bearing rule is unchanged: **agents prepare and enforce; the human decides at
the five gates.**

---

## 1. Why it's not planning and not retro (the anti-redundancy argument)

The three ceremonies share the same roster, so they are only worth having
separately if each owns a distinct **object** and a distinct **landing**. It does:

| Ceremony | Object it changes | Where it lands | Cadence |
|---|---|---|---|
| `/sprint-plan` | **the commitment** (this sprint's goal + committed stories + WIP) | Commit gate (`sprint-plan-new`) | when no sprint is active |
| `/sprint-retro` | **the process** (gates, hooks, tools, discipline) | Vision gate (IDEAs) / tech-health | at sprint close |
| `/refine` | **the backlog's shape** (which PBIs exist, how they're sliced, how parallel they are) | board mutations (create/split/combine/retire) + fan-out FEATs; overflow scope → Vision gate | **between sprints / on drift** — decoupled from sprint close |

The decoupling from sprint close is the point: refinement runs **whenever the
backlog drifts** (stale stories, a serial blob blocking parallelism, duplicate
PBIs), not on the sprint clock. That is what stops it from collapsing into "retro
#2." Conversely, refinement must **not** author process-change proposals (that's the
retro's object) or commit a sprint (that's planning's) — if a lens wants to, it
routes to the owning ceremony instead.

---

## 2. The one invariant it never breaks

**Agents prepare; the human applies the change-set. Lenses NEVER mutate the board
and NEVER invent scope.** Refinement inherently *produces* mutations (create /
split / combine / retire), but the lenses only **recommend** them as a structured
change-set; the human runs the `board.py` verbs (or hands a split to
`backlog-decomposer`). Every created/split slice must be **SAD-anchorable** — a
slice with no valid `sad_refs` is scope invention and becomes an **IDEA at the
Vision gate**, never a story authored here. This is the same firewall the PO and SM
lenses already enforce; refinement adds no exception to it.

---

## 3. The objective: maximize the parallel fraction

Refinement optimizes one measurable quantity:

> **parallel fraction** = the size of the largest set of *Ready* stories whose
> **Touch scopes are pairwise disjoint** (and which share no serialized-spine
> dependency), divided by the Ready backlog.

Disjoint Touch scopes are exactly the SM lens's "lanes"; overlapping ones are
"collisions." The SM lens already computes this from `board.py list --json` Touch
scopes. Refinement's job is to **reshape the backlog to raise the number**, using
the four moves below plus the SM's existing split heuristics
(contract-first, disjoint-file slicing, spine/limbs).

The retros are the evidence this matters: when stories ran on a **shared branch**
instead of isolated worktrees, the review-check gate mis-fired (stale-base
pollution) and siblings collided — RETRO-001 (8 hard-gate blocks, partly false
positives) and RETRO-002 (3 refusals + 2 blocks + 3 overrides, "effective
enforcement ~5%"). A backlog whose Ready stories are *provably* disjoint is what
makes wide, safe fan-out possible instead of merge thrash.

---

## 4. The four moves (and the tooling each needs)

| Move | What the lenses recommend | `board.py` today | Gap to close |
|---|---|---|---|
| **Create** | a missing PBI under an existing capability | `new --capability … --parent FEAT-…` | none — but must be SAD-anchored, else route to Vision as an IDEA |
| **Split** | cut a serial blob on a **disjoint-file seam** to raise the parallel fraction | `backlog-decomposer` skill (human-run) | none — refinement is the natural trigger for it |
| **Combine** | merge two PBIs that are one unit of value / always co-edit the same files (a *negative* parallelism signal — keep coupled work in one story) | **no verb** | add `board.py combine <src…> --into <id>` (or `--new`) that folds AC + Touch scope + `sad_refs`, preserves provenance, and logs an event |
| **Retire** | drop a stale / won't-do / superseded PBI | **no verb / no column** | depends on **IDEA-003** (a terminal `retired`/`won't-do` column) — still unbuilt; RETRO-002 has STORY-029 parked WON'T-DO waiting on it. **Retire is blocked until IDEA-003 lands.** |

So refinement ships in two waves: **Wave 1** (create + split + combine) needs only
a `combine` verb; **Wave 2** (retire) waits on IDEA-003. Note the asymmetry with
splitting: **combine is the anti-parallelism move** — two stories that always touch
the same hot file are a false lane, and merging them removes a collision the SM lens
would otherwise have to serialize.

---

## 5. The ceremony (`/refine [capability-hint]`)

Read-only, three lenses, one synthesized change-set. Mirrors `/sprint-plan`'s
structure so the roster stays familiar.

1. **Precondition.** Prefer **no active sprint** (refine the shape *between*
   commitments). If one is active, `/refine` restricts to Touch scopes **outside**
   the committed stories so it never re-slices work in flight — surface that and
   narrow, don't refuse.
2. **product-owner-lens** — **currency pass**: which PBIs are stale, duplicated,
   superseded, or no longer ladder up to a live epic/feature; which value is missing
   a PBI. Nominates *create* (SAD-anchored) and *retire* candidates. Never authors.
3. **dev-team-lens** — **coupling read**: which PBIs share hot files (schema,
   routing, config, shared types) and so are false lanes; which are one unit of work
   masquerading as two. Nominates *combine* and *split* seams, grounded in the real
   Touch scopes + `tech-health.md`.
4. **scrum-master-lens** — **parallelization architect**: takes the PO's priorities
   and the dev-team's coupling read and produces the target shape — the **split-for-
   parallelism** recommendations that raise the parallel fraction, and the grouping
   of the resulting disjoint stories into **fan-out FEATs** (§6). Stamps the
   **disjointness proof** for each proposed lane set.
5. **Synthesize ONE change-set proposal** — reconcile conflicts explicitly (PO wants
   to keep a PBI the dev-team says is a false lane → decide and note it). Emit the
   change-set as a table of `board.py` commands the **human** runs — never run them.

```
| move    | target              | command (human runs)                                           |
|---------|---------------------|----------------------------------------------------------------|
| split   | STORY-0xx           | (backlog-decomposer) → STORY-0xx-a / -b on a disjoint-file seam |
| combine | STORY-0yy, STORY-0zz| board.py combine STORY-0yy STORY-0zz --into STORY-0yy           |
| create  | (new, CAP-foo)      | board.py new --capability CAP-foo --parent FEAT-0nn             |
| fanout  | FEAT-0nn            | board.py set FEAT-0nn fanout true   (after disjointness proof)  |
| retire  | STORY-029           | (blocked on IDEA-003 terminal column)                          |
```

Everything routes to a gate: SAD-anchored creates/splits/combines are **board
mutations the human applies**; anything needing new architecture or a new theme is
an **IDEA at the Vision gate** (capture≠commit); a `fanout` FEAT feeds the **build
loop**.

---

## 6. The parallel-parent: a **fan-out FEAT**

A parallel-parent is an existing **FEAT marked `fanout: true`** whose child stories
are a **verified-disjoint lane set** — a single prompt then spawns one worktree
agent per child, concurrently. Modeling it as a FEAT (not a new artifact) reuses the
`EPIC→FEAT→STORY` hierarchy, `parent:`, and the renderers unchanged; the only new
state is one boolean + a stamped proof.

### 6.1 What the FEAT carries

- **`fanout: true`** frontmatter — marks the FEAT as a runnable lane set.
- **A disjointness proof** (SM-stamped, e.g. `fanout_verified: <YYYY-MM-DD>` +
  `fanout_children: [STORY-a, STORY-b, …]`) — the children's Touch scopes are
  **pairwise disjoint** and share **no serialized-spine dependency**. This is the
  load-bearing precondition: **without a current proof, the fan-out prompt refuses**
  (see §6.3). A story edit that changes a child's Touch scope **invalidates** the
  proof (a `validate` rule / hook clears `fanout_verified`), forcing re-verification.
- **`fanout_spine:` (optional)** — the contract-first slice (shared type / API
  signature / DB schema / event shape) that must reach `done` **before** the limbs
  fan out. When present, the prompt lands the spine serially first, then fans out.
- **`fanout_wip:` (optional)** — a per-FEAT concurrency ceiling ≤ the active
  sprint's WIP (safe-parallelism, not throughput — from the SM lens).

### 6.2 Why "mark a FEAT" and not a batch or a new object

- **vs. reuse the batch/sprint** — a batch is a *single-active whole-sprint
  commitment*; a fan-out FEAT is a **nestable unit below the sprint**, so several can
  exist and be run as capacity allows without touching the Commit gate.
- **vs. a new `PARALLEL-NNN` object** — a FEAT already groups stories and already
  renders; the trade-off is that children must live **under one feature**. When a
  lane set genuinely spans features, that's the signal to reach for a cross-feature
  object later — but the common case is one feature, so `fanout: true` is the
  lightest thing that works. (Left as a documented extension, not built.)

### 6.3 The fan-out prompt (the "spawn a team" template)

A thin command — `/fanout <FEAT-id> [tier]` — that is **pure orchestration** over
already-authored stories (it invents no scope). It is the claude-code-leverage
lens's mechanics, templated:

```
/fanout FEAT-0nn [tier=A2]

1. READ FEAT-0nn. REFUSE unless fanout: true AND fanout_verified is current
   (re-run /refine's SM disjointness check if stale). This guard is what stops the
   shared-branch merge thrash the retros documented.
2. If fanout_spine is set: run it FIRST, serialized (board.py move → build →
   review), to done. Do not fan out until the shared surface has landed.
3. For each child in fanout_children, concurrently (bounded by fanout_wip / the
   active batch wip_limit):
      - create an ISOLATED git worktree for the child (no shared branch),
      - run /build-toward <child> at <tier> inside it (sad-grounding fires),
      - on green: spawn the code-reviewer subagent on the child diff vs its
        base_commit; board.py review-record; board.py move <child> review.
4. Reviewer fan-out: high-rework lanes (async/error-state, races) get a specialist
   reviewer before review — per the CC-leverage lens.
5. Merge the limbs in the SM's declared order; the human accepts each at the
   Acceptance gate (board.py move <child> done).
6. Report: per-child done/review/blocked + any SAD conflicts for a human decision.
```

The worktree isolation in step 3 is not optional polish — it is the direct fix for
the RETRO-001/002 stale-base friction (siblings on one branch → review-check
mis-fires). The disjointness proof (step 1) + isolated worktrees (step 3) +
contract-first spine (step 2) are the three things that make wide fan-out *safe*
rather than a merge-conflict generator.

---

## 7. Tooling surface to add (minimal, idiomatic)

- **`board.py combine <src…> --into <id>` (`--new` variant)** — fold AC + Touch
  scope + `sad_refs` of the sources into the target, stamp provenance
  (`combined_from:`), retire the sources (needs IDEA-003) or park them, log a
  `combine` event. `validate`: the target's `sad_refs` must cover the union.
- **`board.py set <FEAT> fanout true|false`** — reuses the existing `set` verb;
  extend `SETTABLE_FIELDS` for the FEAT kind with `fanout`, `fanout_children`,
  `fanout_verified`, `fanout_spine`, `fanout_wip`.
- **`validate` additions** — a `fanout: true` FEAT must (a) have ≥2 children, (b)
  have **pairwise-disjoint child Touch scopes** (else `problem: false lane set`), (c)
  carry a **current** `fanout_verified` (else `nudge: re-verify`); editing a child's
  Touch scope clears the stamp.
- **`/refine` command** (`workflow/commands/refine.md`) — convenes PO + dev-team +
  SM read-only, emits the change-set table. No new gate.
- **`/fanout` command** (`workflow/commands/fanout.md`) — the §6.3 orchestrator.
- **(Wave 2, blocked) IDEA-003** — the terminal `retired`/`won't-do` column that
  *retire* and `combine`'s source-parking both need.

Tests extend `workflow/tools/tests/test_board_sprint.py`: `combine` folds AC/scope
and logs provenance; a `fanout` FEAT with overlapping child Touch scopes fails
`validate`; editing a child's Touch scope clears `fanout_verified`.

---

## 8. Anti-patterns guarded

- **No sixth gate** — refinement is prep; the human applies the change-set at
  existing gates (Commit for anchored work, Vision for new scope, the build loop for
  fan-out).
- **No scope invention** — every create/split slice needs valid `sad_refs`; an
  un-anchorable one is a Vision-gate IDEA, not a story.
- **No unsafe fan-out** — a fan-out FEAT refuses to run without a **current
  disjointness proof** + isolated worktrees + (if shared surface) a landed
  contract-first spine. This is the explicit fix for the RETRO-001/002 shared-branch
  friction.
- **No ceremony redundancy** — refinement owns the *backlog's shape* only; process
  changes route to the retro, commitments to planning.
- **No board mutation by lenses** — the three lenses are `tools:`-restricted to
  reads, exactly like planning/retro; the human runs the `board.py` verbs.
- **No silent deletion** — retire goes to a terminal column with a reason (IDEA-003),
  never `rm`; combine preserves `combined_from:` provenance.

---

## 9. Try it (once landed)

```bash
python3 workflow/tools/board.py sprint-show          # prefer no active sprint
/refine CAP-screen                                   # convene PO + dev-team + SM (read-only)
# review the change-set, then apply it yourself (capture≠commit):
python3 workflow/tools/board.py combine STORY-0yy STORY-0zz --into STORY-0yy
python3 workflow/tools/board.py new --capability CAP-screen --parent FEAT-0nn
python3 workflow/tools/board.py set FEAT-0nn fanout true          # after the SM disjointness proof
python3 workflow/tools/board.py validate                          # proves the lane set is disjoint
# then run the parallel parent:
/fanout FEAT-0nn A2                                  # one isolated-worktree agent per child
```

---

## 10. Open questions (for Vision-gate triage)

1. **Combine semantics** — fold-into-existing vs. always-new-id? (Provenance is
   cleaner with a new id; churn is lower folding into the survivor.)
2. **Cross-feature lane sets** — when a disjoint set spans features, do we relax the
   "children under one FEAT" rule, or introduce the `PARALLEL-NNN` object then?
3. **Proof freshness** — should `fanout_verified` expire on a clock as well as on
   Touch-scope edits, given the backlog moves under it?
4. **Retire vs. IDEA-003** — land the terminal column first (Wave 2 dependency) or
   ship refinement Wave 1 (create/split/combine) without retire?
