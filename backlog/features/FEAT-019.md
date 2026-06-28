---
id: FEAT-019
type: feature
parent: EPIC-006
sad_refs: SAD-003#3.3, SAD-003#5.3, SAD-003#2.4
capabilities: CAP-eod-coverage
---

# FEAT-019 — Run coverage & freshness reporting

The guardrail that makes "a run that silently drops names is a failure"
structural: every fetch run produces a coverage (% of universe fetched) and
freshness (max staleness) report, commits the successful set on partial failure,
and exits non-zero below a configured coverage threshold.

## Parent
EPIC-006

## Capabilities covered
- `CAP-eod-coverage` (SAD-003#3.3) — the coverage/freshness reporter + partial-
  failure policy (`SAD-003#5.3`, `SAD-003#8.5 / ADR-005`).

Stories use `parent: FEAT-019` and the `CAP-eod-coverage` capability id.

## Notes
- Create stories via `python tools/board.py new --capability <id> --parent FEAT-019`.
