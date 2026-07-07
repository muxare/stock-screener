---
description: Convene three read-only lenses (PO + Dev-team + Scrum-Master) to refine & consolidate the backlog — create/split/combine/retire PBIs to keep it current and maximize the parallel fraction. Prepares a change-set the human applies. Usage: /refine [capability-hint]
---

# /refine [capability-hint]

Run **Backlog Refinement & Consolidation** — the ceremony that reshapes the
**backlog itself** so it stays current and so the **largest possible number of Ready
stories can run as concurrent agents in isolated worktrees**. Full design:
`workflow/docs/backlog-refinement.md`. This command **prepares** a change-set; the
**human applies it** with `board.py`.

## Invariant (do not break)
**Agents prepare; the human applies the change-set. This adds NO sixth gate.** The
three lenses are **read-only** — they run only *read* `board.py` subcommands and read
files; they never `new`/`set`/`combine`/`move`/`reject` or edit anything. Every
created/split slice must be **SAD-anchorable** — an un-anchorable one is an IDEA at
the **Vision gate** (capture≠commit), never a story authored here. Refinement owns the
*backlog's shape* only: process changes route to `/sprint-retro`, commitments to
`/sprint-plan`.

## Precondition
Prefer **no active sprint** (refine the shape *between* commitments). Check
`python3 workflow/tools/board.py sprint-show`. If a sprint is active, restrict the
pass to Touch scopes **outside** the committed stories so work in flight is never
re-sliced — surface that and narrow, don't refuse.

## The objective
Maximize the **parallel fraction**: the largest set of Ready stories whose **Touch
scopes are pairwise disjoint** and which share no serialized-spine dependency,
over the Ready backlog. Every recommendation is justified by whether it raises it.

## The team (staged — sense first, then shape)
**Wave 1 — sense the backlog (parallel, blind to each other).** Spawn concurrently
(one message, parallel Agent calls); the independence is the point:

1. **product-owner-lens** — the **currency read**: stale / duplicated / superseded
   PBIs, ones that no longer ladder up to a live epic/feature, and value gaps missing
   a PBI. Nominates *retire* and *create* (SAD-anchored) candidates. **Reads the
   firewalled IDEA inbox** (`board.py idea-list --json`) read-only, for three things:
   (a) **dedup** — never nominate a *create* for scope already captured as an IDEA;
   (b) **consolidate** — cluster similar/duplicate inbox ideas (by content + `born_from`
   provenance) and recommend **merges** or **supersedes** so the inbox stays
   high-signal rather than a pile of near-dupes (e.g. two ideas for the same recurring
   friction → one); (c) **ripeness** — flag any inbox IDEA now SAD-anchorable as a
   *promote* candidate for the Vision gate. All three are **recommendations only** —
   the human applies them (promotion at the Vision gate; a merge by capturing the
   consolidated idea via `idea-new` and archiving the sources via `idea-archive`).
   Refine never mutates the inbox and never authors a story from an idea. (value & scope)
2. **dev-team-lens** — the **coupling read**: which PBIs share hot files (false lanes
   ⇒ *combine* candidates), which are one unit of work masquerading as two, and the
   **disjoint-file split seams** for serial blobs. Grounded in real Touch scopes +
   `backlog/tech-health.md`. (engineering reality)

**Wave 2 — shape the parallelism.** Pass both outputs to:

3. **scrum-master-lens** — the **target parallel shape**: split-for-parallelism +
   combine recommendations that raise the parallel fraction, the resulting disjoint
   stories grouped into **fan-out FEATs** (`fanout: true`), and a **stamped
   disjointness proof** (`fanout_children` + `fanout_verified`, pairwise-disjoint
   Touch scopes, contract-first `fanout_spine` where a surface is shared) that the
   `/fanout` guard requires. Verifies overlaps against the real files. (parallelization)

Pass each the `[capability-hint]` (if given) as the area of focus.

## Synthesize ONE change-set proposal
Reconcile the three outputs; resolve conflicts explicitly (PO wants to keep a PBI the
dev-team calls a false lane → decide and note it). Emit the change-set as a table of
the **exact `board.py` commands the human runs** — do not run them:

```
| move    | target               | command (human runs)                                            |
|---------|----------------------|-----------------------------------------------------------------|
| split   | STORY-0xx            | (hand to backlog-decomposer) → STORY-0xx-a / -b on disjoint seam |
| combine | STORY-0zz → STORY-0yy| board.py combine STORY-0zz --into STORY-0yy                      |
| create  | (new, CAP-foo)       | board.py new --capability CAP-foo --parent FEAT-0nn              |
| fanout  | FEAT-0nn             | board.py fanout FEAT-0nn --children STORY-a,STORY-b [--spine …]  |
| retire  | STORY-029            | board.py retire STORY-029 --reason "…"                           |
| promote | IDEA-0nn             | (Vision gate — human triages) board.py new … then set sad_refs   |
| merge   | IDEA-005, IDEA-008   | (inbox hygiene) board.py idea-new <consolidated> + archive sources|
```

## Where it lands (no orphan output)
- SAD-anchored **create / split / combine** → **board mutations the human applies**.
- A verified **fan-out FEAT** → the **build loop** (`/fanout FEAT-0nn`).
- **Retire** → a terminal-column move (`board.py retire`).
- **Ripe IDEA** → a *promote* recommendation to the **Vision gate** (the human
  triages it into a story); refine never authors the create itself.
- **Similar IDEAs** → a *consolidation* recommendation — the human merges them
  (capture the union via `idea-new`, archive the sources). Pure **inbox hygiene**,
  **no gate**: merging ideas never promotes or commits scope, so — like
  `idea-archive` — it doesn't route through Vision.
- Any un-anchorable scope or new theme → an **IDEA** at the **Vision gate**
  (`board.py idea-new`), never a story invented here.

After the human applies the change-set, `board.py validate` proves each `fanout: true`
FEAT is a real disjoint lane set, and the parallel fraction is higher than it started.
Feed the shaped backlog into the next `/sprint-plan`.
