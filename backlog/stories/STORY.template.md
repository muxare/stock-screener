---
id: STORY-000
type: story
parent: FEAT-000           # feature this rolls up to
capability: <capability-id> # SAD#3.x capability this builds toward — the loop selector
sad_refs: SAD#5.2              # REQUIRED, non-empty. One anchor, comma-separated,
                                # or bracket list: [SAD#5.2, SAD#6.1]
target: ~                  # optional named slice, e.g. alpha
estimate: ~
attempts: 0                # bookkeeping, stamped by board.py on each start
prev_column: ~             # set by board.py when blocked, so unblock returns home
blocked_reason: ~
reject_reason: ~           # set by board.py reject; the rework brief, read on re-entry
---

## User Story
As a <role>, I want <capability> so that <benefit>.

## Acceptance Criteria
- [ ] <criterion — written BEFORE implementation, checkable>
- [ ] <criterion>

## Architectural Constraints (from SAD)
- Follow the pattern in <SAD#anchor>. Do NOT introduce <forbidden thing>.
- Persistence/state per <SAD#anchor>.

## Out of scope
- <explicitly excluded — even if tempting. Tracked elsewhere if real.>

## Claude Code Prompt
> Implement the acceptance criteria above.
> READ the SAD sections listed in `sad_refs` BEFORE writing code and treat
> them as binding. If any requirement conflicts with the SAD, STOP and flag
> it rather than improvising. Stay within "Touch scope". Add nothing beyond
> the acceptance criteria.

## Touch scope
- <path/glob>               # repo-relative; supports * and ** (e.g. src/**, apps/billing/**)
