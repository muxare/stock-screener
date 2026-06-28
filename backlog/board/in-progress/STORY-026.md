---
id: STORY-026
type: story
parent: FEAT-009
capability: CAP-detail
sad_refs: [SAD#5.4, SAD#3.12, SAD#2.3]
target: ~
estimate: ~
attempts: 1
prev_column: ~
blocked_reason: ~
base_commit: e785f23eaac47dd27c04c453a473da94bea106bf
---

## User Story
As a trader, I want the detail and compare views to show a clear loading/error state when a name's data can't be fetched so that a failed request never looks like an unclickable row or an empty comparison.

## Context
From the STORY-018 code review (findings 7, 8). Detail and compare now fetch a
name's bars on demand via `/instrument/:ticker` and build the Stock locally
(SAD#5.4). `ensureDisplayed` swallows 404/network errors, so a failed (or
not-yet-landed) fetch renders as silence: the detail overlay returns null and
Compare drops the column — with no spinner, error, or explanation.

## Acceptance Criteria
- [x] `ensureDisplayed` records a per-ticker status (loading / loaded / error)
      rather than silently no-op'ing on failure. (`src/store.ts`)
- [x] Selecting a row whose `/instrument` fetch is in flight shows a loading
      affordance in the detail panel; a fetch that fails shows an error state
      with a retry, not a blank/absent panel. (finding 7 —
      `src/components/detail/DetailPanels.tsx`, overlay + docked)
- [x] The Compare drawer never opens under-populated: while selected names are
      still loading it shows a loading state, and a name whose fetch failed is
      shown as an error column (or excluded with a visible note) — it never
      silently renders a 1-column or empty "comparison". (finding 8 —
      `src/components/compare/Compare.tsx`)
- [x] A retry re-requests the failed name and resolves the affordance on success.
- [x] Tests cover detail + compare under a failing/slow `/instrument` fetch.

## Architectural Constraints (from SAD)
- Detail/compare compute locally for the displayed name only (SAD#5.4 / SAD#2.5)
  within the SAD#2.3 ≤ 50 ms budget — keep that; this story adds status, not
  full-universe work.
- Per-ticker fetch status belongs in the SAD#5.9 store alongside `displayed`;
  do not add a second store.
- CAP-compare (SAD#3.12) guarantees ≥ 2 side-by-side names when opened — honour
  it by gating on loaded data, not by silently dropping columns.

## Out of scope
- Store request-sequencing / re-entrancy (STORY-025).
- Reconnect after a full service outage at load (STORY-027) — this story covers
  per-name fetch failures while the service is otherwise reachable.

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- src/store.ts
- src/components/detail/**
- src/components/compare/**
- tests/**
