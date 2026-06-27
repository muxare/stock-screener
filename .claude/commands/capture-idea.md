---
description: Capture a discovery found mid-flow without smuggling it into the current story. Forks by discovery type — in-scope → STORY, out-of-scope → firewalled idea inbox. Usage: /capture-idea [free-text describing what you found]
---

# /capture-idea [what you found]

The sanctioned **return-edge** (#16). A discovery found while building has only
two bad exits without this command: smuggle it into the current story (the exact
scope-creep the SAD valve exists to block — friction F3) or drop it. This gives
it a third, honest home. Any agent or human can fire it from anywhere mid-flow.

**Capture ≠ commit.** Nothing here mutates the board or starts work. The whole
job is to route the discovery to the right place so a human decides later.

## The fork (do this first — it's the whole command)

Classify the discovery against the **SAD**, then route:

- **In-scope** — it's anchored to an existing `SAD#3` capability (the architecture
  already covers it; it's just unbuilt work). → It is a **STORY**, not an idea.
  Author it through the existing backlog path (a child of the right feature, with
  `capability` + ≥1 `sad_refs`). Do **not** use `idea-new` — that would bury real,
  buildable work in the firewalled inbox.

- **Out-of-scope** — it needs architecture the SAD does **not** have yet (a new
  capability, a component, an ADR/vendor decision). → It is an **IDEA**. Capture
  it to the firewalled inbox:

  ```
  python3 tools/board.py idea-new \
    --title "<short title>" \
    --born-from <origin STORY-NNN or RETRO-NNN> \
    --found-by <agent/human> \
    --why "<the SAD section or ADR this would need>"
  ```

  This stamps provenance (`captured`, `born_from`, `found_by`, `why`,
  `discovery_type: out-of-scope`) and writes `IDEA-NNN` to `backlog/ideas/`.
  It is **firewalled from the build loop** — `/build-toward` only picks
  `board/todo`, and `validate` blocks any story parented directly on an IDEA.
  It cannot become work until a human promotes it at **Gate 1**
  (`/refine-idea IDEA-NNN PLAN-NNN` → SAD amendment/ADR).

**When unsure which side of the fork you're on, capture it as an idea.** The
firewall is the safe default: an idea wrongly parked is recoverable at Gate 1;
scope smuggled into a story is the failure mode this command exists to prevent.

## After capturing

- Confirm where it landed: `python3 tools/board.py idea-list` (the inbox) or the
  new story's column. Both also surface on `board.py render` (board.md "Idea
  inbox") and the `render-html` **Idea inbox** tab.
- **Where it lands at a gate:** an out-of-scope idea waits in the inbox for the
  Product-Owner lens to triage at **Gate 1**; an in-scope story enters the normal
  build flow at **Gate 3**. Either way you are done — do not build it now.
