---
id: FEAT-017
type: feature
parent: EPIC-005
sad_refs: SAD-002#5.6, SAD-002#8.8
capabilities: CAP-dag-schedulable
---

# FEAT-017 — Schedulability seam

Expose the DAG's topological ordering and a per-(node, bar) value accessor as a
small, stable, read-only engine surface (SAD-002#5.6) so the screening service
(`SAD-001#4.2`) can later materialise lower levels and prune — and so the
deferred temporal layer has a documented seam to sit on (SAD-002#8.8). Delivers
the *enabling contract only*: no server, transport, or materialisation code.

## Parent
EPIC-005

## Capabilities covered
- `CAP-dag-schedulable` (SAD-002#3.9) — stable topological ordering + addressable
  per-(node, bar) values, with a documented example of lower-level nodes computed
  independently of any single rule.

## Notes
- Create stories via `python tools/board.py new --capability <id> --parent FEAT-017`.
- Depends on the evaluator (FEAT-013). Must add NO server code (SAD-002#1.2).
