---
id: RETRO-000
type: retro
batch: BATCH-000            # the sprint this retros (must be closed/closing)
created: <YYYY-MM-DD>
window_start: <batch.created>
window_end: <batch-close ts, or now if still closing>
committed: 0               # len(stories:) at close
shipped: 0                 # committed stories that reached done within the window
---

<!-- Authored by `board.py sprint-retro` (no flags) on a CLOSED sprint. The
     command fills committed-vs-shipped + a frozen metrics snapshot; the
     /sprint-retro ceremony fills Observations + the proposals table. -->

## Committed vs shipped
- committed: <STORY ids>
- shipped:   <STORY ids>
- carried:   <still open at close>
- unplanned: <shipped, not committed>

## Metrics snapshot          # frozen copy of `metrics --sprint BATCH-000`
- cycle: median — · p90 — (n=0)
- review-check: 0/0 refused · 0 hard-gate block(s)
- bounce: 0 / 0 reached-review
- blocked: none

## Observations
- <evidence-anchored friction, one bullet each>

## Workflow-change proposals
<!-- Top 1–3 frictions as concrete changes to a NAMED artifact (gate/file/tool).
     `board.py sprint-retro --accept P-N` flips to accepted AND spawns an IDEA
     (capture≠commit); `--reject P-N` flips to rejected. status ∈ {proposed,
     accepted, rejected}; an accepted proposal must record its spawned IDEA in
     `result` or `validate` flags it as dangling. -->

| id  | target (gate/file/tool)         | type    | status   | result    |
|-----|---------------------------------|---------|----------|-----------|
| P-1 | <e.g. board.py done-gate>       | tool    | proposed | —         |
