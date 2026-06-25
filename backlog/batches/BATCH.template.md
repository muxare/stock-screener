---
id: BATCH-000
type: batch
status: active            # active | closed — only ONE active batch at a time (Gate 3)
created: <YYYY-MM-DD>      # stamped by board.py batch-new
wip_limit: 3              # max stories in-progress at once while this batch is active
capabilities: [CAP-x]    # SAD#3 capabilities committed to this batch — the build slice
---

## Goal
<the Gate-3 commitment in one line — what this batch is meant to ship>

## Capabilities committed
- CAP-x — <why it's in this batch>

## Notes
<prioritisation rationale, dependencies, anything the next batch should inherit>
