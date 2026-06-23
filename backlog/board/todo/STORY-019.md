---
id: STORY-019
type: story
parent: FEAT-010
capability: CAP-presets
sad_refs: [SAD#5.8, SAD#6.4, SAD#2.8, SAD#8.6]
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
---

## User Story
As an engineer, I want artifacts persisted behind a repository interface so that the backing store can change without touching feature code.

## Acceptance Criteria
- [ ] A repository interface covers indicators, presets, and named screens (SAD#5.8).
- [ ] The current direct `localStorage` access in `store.ts` is refactored behind the interface.
- [ ] Feature code reads/writes artifacts ONLY through the interface.
- [ ] Artifacts carry a schema version enabling future migration (SAD#6.4).
- [ ] Create an artifact, reload, confirm it is still present (SAD#2.8).

## Architectural Constraints (from SAD)
- All artifact persistence goes through the SAD#5.8 interface; components must not touch the storage mechanism directly.
- Keep a user-id dimension addable later without changing call sites (SAD#8.6).

## Out of scope
- Accounts/auth (SAD#1.2 — out of scope until persistence forces it).

## Status
TODO — partial today: persistence works but as direct `localStorage` in `store.ts`, not behind an interface.

## Claude Code Prompt
> Implement the acceptance criteria above. READ the SAD sections listed in `sad_refs` BEFORE writing code and treat them as binding. If any requirement conflicts with the SAD, STOP and flag it. Stay within Touch scope; add nothing beyond the acceptance criteria.

## Touch scope
- src/lib/repo/**
- src/store.ts
