# BATCH-003 Sprint Planning Analysis — "Real Data" (EOD pipeline)

> Companion artifact to the `BATCH-003.md` commitment. Produced by the
> `/sprint-plan` ceremony on 2026-06-28. This is the **analysis and reasoning**
> behind the proposal; the terse `BATCH-003.md` (written by
> `board.py sprint-plan-new`) holds the **commitment**. This file is advisory
> documentation — it did **not** mutate the board. Status at write time: **no
> active sprint; Gate 3 open; not yet committed** — subsequently committed as
> `BATCH-003` (the auto-numbered id; this analysis predates the number, hence the
> original `BATCH-002-plan.md` filename).

---

## 1. Proposed sprint goal (falsifiable, capability-anchored)

> **The operator can run a one-command historical backfill that fetches real
> Yahoo Finance EOD bars for a ticker universe and writes them into the existing
> SQLite DB through the unmodified importer — pointing `MARKETDATA_DB` at the
> result runs the screener on real data, with no engine, handler, or port change.**

**Verdict rule:** MET iff **STORY-050 and STORY-051 are both `done`** at close and
a screen runs against the Yahoo DB without error. STORY-053 strengthens the goal;
the two capacity-fill stories (022, 033) do not bear on the verdict.

---

## 2. Committed capabilities (goal spine)

| Capability | SAD anchors | Carried by |
|---|---|---|
| CAP-eod-fetch | SAD-003#5.1, #3.1, #8.3, #8.6, #2.7 | STORY-050 |
| CAP-eod-ingest | SAD-003#5.2, #3.2, #6.1, #8.2, #8.4 | STORY-051 |
| CAP-eod-coverage | SAD-003#5.3, #3.3 | STORY-053 (goal-strengthening) |

SAD-003 is the most mature open SAD (**Reviewed**), which is why the goal anchors
here rather than on SAD-001 (Draft) or SAD-002 (Draft).

---

## 3. Committed stories (value-ordered, WIP-bounded, Ready)

| # | Story | Cap | Role | Size | Touch scope / note |
|---|---|---|---|---|---|
| 1 | STORY-050 | eod-fetch | goal-critical | M | Greenfield `tools/yahoo-fetch/**`, `package.json`. No upstream dep. Day-1 start. |
| 2 | STORY-051 | eod-ingest | goal-critical | M | After 050 **and** STORY-031 accepted at Gate 4. Calls `tools/eod-import` as subprocess/module. |
| 3 | STORY-053 | eod-coverage | goal-strengthening | M | Branches off 050's per-ticker failure shape; parallel to 051. |
| 4 | STORY-022 | results | capacity fill | S | Compliance disclosure (SAD#2.7). Independent — `src/components/**`. |
| 5 | STORY-033 | screen | capacity fill | S | Refuse synthetic/SQLite adapters when `NODE_ENV=production` (SAD#5.10, #8.7). Data-layer-adjacent; `server/universe.ts`. |

**WIP limit: 3** (Scrum-master). The review-check gate is the binding constraint
(40% refusal); do not raise WIP without first reducing that friction.

### Deferred this sprint (with reason)
- **STORY-052** (daily append) — depends on 051; next-sprint tail.
- **All SAD-002 DAG stories** (039–047) — SAD-002 is Draft; needs a dedicated
  sprint after EOD, and the SAD must reach Reviewed before Gate-3 commitment.
- **STORY-019/034/036/037/038/054** — next SAD-001 polish sprint.
- **STORY-015** — stays blocked (ADR-008 vendor/redistribution sign-off, Gate 2/5).

---

## 4. Conflict reconciliation across the four lenses

| Lens | Position | Resolution |
|---|---|---|
| **Product-Owner** (value) | EOD sprint — SAD-003 Reviewed; real bars turn demo into tool; biggest capability gap. | **Adopted as the goal.** Capability value outweighs the parallelism-only case. |
| **Dev-team** (engineering) | Three file-independent tracks. EOD self-contained on a Reviewed SAD; DAG blocked on Draft SAD-002. EOD chain is sequential 050→051, 053 branches off 050. | Goal = Track C. Confirms 022/033 (Track A) share no files with EOD → safe to graft as parallel fill. |
| **Scrum-master** (flow) | WIP 3; 5–6 stories; accept STORY-031 first; don't commit Draft-SAD stories; close STORY-029. | WIP 3, 5 stories. EOD allowed because SAD-003 is Reviewed (not Draft). |
| **CC-leverage** (execution) | Preferred SAD-001 polish purely for parallelism; tier A2; fix the 40% review-check refusal. | Parallelism need satisfied by grafting 022/033 as parallel worktrees onto the EOD goal — without sacrificing capability value. |

**Core tension:** the EOD chain is sequential and under-fills a WIP-3 capacity. The
PO goal alone is 2–3 stories with only 1–2 in flight at a time. **Resolution:** keep
the single falsifiable EOD goal as the spine, and graft two zero-conflict SAD-001
fill stories (022, 033) as parallel worktree agents to use the idle capacity. One
goal; fully-utilized WIP.

---

## 5. Execution strategy (CC-leverage)

**Precondition:** accept **STORY-031** at Gate 4 (`board.py move STORY-031 done`)
before launch — review-check passes cleanly; STORY-051 depends on the importer it
provides.

```
Gate 4: accept STORY-031
   |
   +-- worktree-eod:   STORY-050  ->  STORY-051        (serial chain)
   |                        \-> STORY-053               (branch after 050)
   +-- worktree-022:   STORY-022                        (parallel, src/components/**)
   +-- worktree-033:   STORY-033                        (parallel, server/universe.ts)
```

- **Tier:** A2 (implement and stop at review). SAD-001/003 architecture is settled
  in practice (29 done stories).
- **Reviewer fan-out:** on **STORY-051** — the importer-coupling / ingest seam is
  the highest-integration surface in the sprint.
- **Three tracks are file-independent** (dev-team): EOD lives in `tools/yahoo-fetch/**`,
  022 in `src/components/**`, 033 in `server/universe.ts`. No merge conflicts expected.

---

## 6. Definition-of-Ready flags (Product-Owner)

| Story | DoR | Flag |
|---|---|---|
| STORY-050 | READY | Clear AC, bounded greenfield scope, no upstream dep |
| STORY-051 | CONDITIONALLY READY | Depends on STORY-031 passing Gate 4 |
| STORY-053 | CONDITIONALLY READY | Depends on STORY-050's per-ticker failure surface |
| STORY-022 | READY | Clear AC, `src/components/**`, no deps |
| STORY-033 | READY | Clear AC, `server/universe.ts` + tests, no deps |

---

## 7. Rework risks (Dev-team)

- **STORY-051** — couples to the `tools/eod-import` CLI/module interface. Low risk
  because the importer already exists and uses `ON CONFLICT REPLACE` upsert; only a
  Gate-4 *interface* change to STORY-031 would ripple. Mitigated by accepting
  STORY-031 first.
- **STORY-053** — must consume the structured per-ticker failure shape that
  STORY-050 defines; sequence 050's failure model before 053 starts.
- **STORY-050** — polite rate-limiting + retry/backoff against a live external
  endpoint; use injectable HTTP with recorded fixtures so tests don't hit Yahoo.

(The heavy rework risks — STORY-043 dag-lower, STORY-040 bounded cache,
STORY-038 shared wire types — all sit in deferred tracks and are documented here
only so the next planning cycle inherits them.)

---

## 8. Flow / capacity notes (Scrum-master)

- Cycle time: median **78m**, p90 **1.7h**, max **13.6h** (STORY-035, lone outlier).
- Bounce rate from review: **0%** across 10 stories — quality is holding.
- Review-check refusal: **2/5 runs (40%)**, 8 hard-gate move blocks — the binding
  constraint on WIP. If refusal climbs >50% next sprint, drop WIP to 2.
- Blocked time: **44.4h total, entirely STORY-029** (WON'T-DO) — close it at Gate
  2/5 so it stops polluting the blocked column.
- Demo-sweep anomaly (F7): STORY-048/049 marked done in <30s with no real loop —
  inflates `done` count by 2 (effective verified throughput 27, not 29).

---

## 9. Preparation / enablers

| Route | Item | Rationale |
|---|---|---|
| `note:` | **PRECONDITION** — accept STORY-031 at Gate 4 before launch | STORY-051 depends on the importer it provides |
| `note:` | Close STORY-029 (WON'T-DO) at Gate 2/5 | Clears 44.4h of stale blocked-time from the board |
| `idea:IDEA-005` | review-check diffs Touch-scope paths (ignore `backlog/**`, `.workflow/**`) | Targets the 40% review-check refusal / scope-creep friction |
| `idea:IDEA-006` | DoR checklist + `validate` warn on shared `base_commit` | Closes the F7 demo-sweep (STORY-048/049) anomaly |
| `note:` | SessionStart re-grounding hook | sad-grounding fired only 2/550 events; stand up before the DAG sprint. Not yet captured — Gate-1 candidate |

No new ideas were invented and no story was fabricated during planning; all
out-of-scope discoveries were already captured as IDEA-005/006.

---

## 10. Two decisions for the human at Gate 3

1. **STORY-031's Gate-4 outcome.** It's in `review` and review-check passes
   cleanly. Accept it → STORY-051 unblocked, goal stands. Do **not** accept it →
   the goal collapses to STORY-050 alone (insufficient as a standalone falsifiable
   outcome); pivot to a SAD-001 polish sprint (PO's documented alternative:
   STORY-022, 033, 036, 037, 054 closing SAD-001 safety/compliance gaps).
2. **Sprint shape.** Commit all 5 as proposed (EOD spine + two parallel fills,
   full WIP-3 utilization), or trim to the pure 3-story EOD spine (050/051/053) for
   a tighter goal-only focus.

---

## 11. Gate-3 command (the human runs this to commit; the ceremony did not)

```
python3 workflow/tools/board.py sprint-plan-new \
  --goal "Operator runs a one-command historical backfill fetching real Yahoo EOD bars into the existing SQLite DB via the unmodified importer; MARKETDATA_DB points the screener at real data with no engine/handler/port change" \
  --capabilities CAP-eod-fetch,CAP-eod-ingest,CAP-eod-coverage \
  --stories STORY-050,STORY-051,STORY-053,STORY-022,STORY-033 \
  --prep "note:PRECONDITION accept STORY-031 at Gate 4 before launch (STORY-051 depends on it),note:close STORY-029 WONT-DO at Gate 2/5,idea:IDEA-005,idea:IDEA-006,note:SessionStart re-grounding hook before DAG sprint" \
  --exec-strategy "Accept STORY-031 first; EOD chain 050->051 serial in one worktree, 053 branches off 050, 022+033 as parallel worktree agents; tier A2; reviewer fan-out on 051" \
  --wip 3
```
