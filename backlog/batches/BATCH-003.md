---
id: BATCH-003
type: batch
status: closed
created: 2026-06-28
wip_limit: 3
capabilities: [CAP-eod-fetch, CAP-eod-ingest, CAP-eod-coverage]
stories: [STORY-050, STORY-051, STORY-053, STORY-022, STORY-033]
---

## Goal
Operator runs a one-command historical backfill fetching real Yahoo EOD bars into the existing SQLite DB via the unmodified importer; MARKETDATA_DB points the screener at real data with no engine/handler/port change

## Capabilities committed
- CAP-eod-fetch
- CAP-eod-ingest
- CAP-eod-coverage

## Stories committed
- STORY-050 — goal-critical (CAP-eod-fetch, M). Greenfield `tools/yahoo-fetch/**`; fetches real Yahoo EOD bars. No upstream dep — day-1 start; defines the per-ticker failure shape 051/053 build on.
- STORY-051 — goal-critical (CAP-eod-ingest, M). Writes fetched bars into the existing SQLite DB via the unmodified `tools/eod-import`. Starts after 050 **and** STORY-031 accepted at Gate 4. Reviewer fan-out target (highest-integration seam).
- STORY-053 — goal-strengthening (CAP-eod-coverage, M). Coverage/reporting over the backfill; branches off 050's per-ticker failure surface, runs parallel to 051. Strengthens the goal but does not bear on the MET verdict.
- STORY-022 — capacity fill (S). Compliance disclosure (SAD#2.7), `src/components/**`. Zero file overlap with the EOD chain — grafted as a parallel worktree to use idle WIP.
- STORY-033 — capacity fill (S). Refuse synthetic/SQLite adapters when `NODE_ENV=production` (SAD#5.10, #8.7), `server/universe.ts`. Data-layer-adjacent but file-independent — parallel worktree.

## Execution strategy
Accept STORY-031 first; EOD chain 050->051 serial in one worktree, 053 branches off 050, 022+033 as parallel worktree agents; tier A2; reviewer fan-out on 051

## Preparation / enablers
- note:PRECONDITION accept STORY-031 at Gate 4 before launch (STORY-051 depends on it)
- note:close STORY-029 WONT-DO at Gate 2/5
- idea:IDEA-005
- idea:IDEA-006
- note:SessionStart re-grounding hook before DAG sprint

## Notes
- **Verdict rule:** sprint goal is MET iff **STORY-050 and STORY-051 are both `done`** at close and a screen runs against the Yahoo DB without error. STORY-053 strengthens the goal; the two capacity-fill stories (022, 033) do not bear on the verdict.
- Full planning analysis (four-lens reasoning, conflict reconciliation, DoR/rework/flow notes): see `backlog/batches/BATCH-003-plan.md` — authored by the `/sprint-plan` ceremony as the analysis behind this commitment.
- Goal anchors on **SAD-003** (Reviewed), the most mature open SAD.
