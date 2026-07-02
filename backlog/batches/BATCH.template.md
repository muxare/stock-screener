---
id: BATCH-000
type: batch
status: active            # active | closed — only ONE active at a time (Commit gate = one sprint)
created: <YYYY-MM-DD>      # stamped by board.py sprint-plan-new / batch-new
wip_limit: 3              # max stories in-progress at once while this sprint is active
capabilities: [CAP-x]     # SAD#3 capabilities committed to this sprint — the build slice
stories: [STORY-000]      # OPTIONAL — the specific stories committed this sprint
---

## Goal
<the sprint goal: ONE falsifiable outcome, capability-anchored — NOT a task list.
 "Ship a service-backed screener a user can trust under flaky network." Answerable
 MET/PARTIAL/MISSED at close.>

## Capabilities committed
- CAP-x — <why it's in this sprint>

## Stories committed
- STORY-000 — <why it's in, the value it delivers>

## Execution strategy
<how Claude Code agent teams run this sprint: which stories run as INDEPENDENT
 parallel agents (separate worktrees) vs which must be SERIALIZED (shared files /
 dependency), where a reviewer fan-out helps, and the autonomy tier (A1/A2/A3).>

## Preparation / enablers
<work that makes FUTURE sprints easier — enabler/spike/techdebt/tooling. One per line:
   - story:STORY-00x — a committed, SAD-anchored enabler (also in `stories:`)
   - idea:IDEA-00n   — firewalled groundwork awaiting Vision gate triage (capture≠commit)
   - note:<thought>  — a bare planning thought, no id (inert)>

## Notes
<prioritisation rationale, deferred candidates, dependencies the next sprint inherits>
