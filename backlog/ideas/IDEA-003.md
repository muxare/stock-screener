---
id: IDEA-003
type: idea
status: inbox
captured: 2026-06-28
discovery_type: process
born_from: STORY-029
found_by: build-toward CAP-detail loop + product decision
why: board.py COLUMNS has no closed/wont-do terminal; a dropped story has to sit in 'blocked', where it nags the Gate-2/5 exception queue forever and 'done' would miscount throughput. Affects tools/board.py (COLUMNS, exceptions, metrics).
---

# IDEA-003 — Board needs a terminal 'won't-do/closed' state for consciously-dropped stories

board.py COLUMNS has no closed/wont-do terminal; a dropped story has to sit in 'blocked', where it nags the Gate-2/5 exception queue forever and 'done' would miscount throughput. Affects tools/board.py (COLUMNS, exceptions, metrics).

_Capture≠commit: firewalled from the build loop until a human promotes it through Gate 1 (refine → plan → SAD amendment/ADR)._
