---
id: BATCH-004
type: batch
status: active
created: 2026-06-30
wip_limit: 3
capabilities: [CAP-eod-ingest, CAP-screen]
stories: [STORY-052, STORY-054, STORY-036, STORY-037]
---

## Goal
Run the screener on auto-refreshing real market data with no silent failures in the fetch path: complete the PLAN-003 daily-append pipeline (CAP-eod-ingest) and eliminate the three fetch-path silent-failure modes (instrument-timeout spinner, swallowed dev-import body-parse error, prod dev-probe 404) (CAP-screen).

## Capabilities committed
- CAP-eod-ingest
- CAP-screen

## Stories committed
- STORY-052 — <why it's in this sprint>
- STORY-054 — <why it's in this sprint>
- STORY-036 — <why it's in this sprint>
- STORY-037 — <why it's in this sprint>

## Execution strategy
A1; Wave1 parallel worktrees STORY-052/036/037, Wave2 STORY-054 after 036+037 merge; standard single R-1 reviewer; /clear between waves

## Preparation / enablers
- idea:IDEA-005
- idea:IDEA-008
- idea:IDEA-009
- idea:IDEA-010
- idea:IDEA-011
- note:close STORY-029 WON'T-DO at the Exception gate
- note:fix BATCH-003-plan invalid batch-id breaking validate

## Notes
