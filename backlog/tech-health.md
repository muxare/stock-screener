# Tech-health register

The **standing technical picture** the Dev-team lens keeps between sprints: code
state, technical debt, hotspots, coverage posture, and known risk. It exists so
"look at the state of the code" is a *continuous* read, not a from-scratch scan
each planning cycle, and so tech reality can be turned into prioritisable backlog
items (enablers / techdebt) that compete for value at the Commit gate.

**How this is maintained (governance).** The advisory lenses are **read-only** —
they never edit this file. The flow is: the **Dev-team lens reads** this register
each planning to ground its feasibility/rework read, and **recommends updates** to
it at retro (add / close / re-severity an item). A **human applies** those
recommendations (or re-runs the survey below). Nothing here auto-mutates; it rides
the same "agents prepare, human decides at the gate" invariant as the board.

_Seeded 2026-07-04 from an automated survey at commit-count 101. Figures are
signals, not verdicts — the Dev-team lens confirms/prioritises them._

---

## Snapshot

| Signal | Value | Note |
|---|---|---|
| Source files (ts/tsx, excl tests) | 48 | `src/`, `server/`, `tools/` |
| Test files | 19 | ~0.40 test-to-source ratio (file count, **not** line coverage) |
| Line coverage | **unmeasured** | `vitest` runs without `--coverage`; no real number exists yet |
| TODO/FIXME/HACK markers | 0 | debt is *not* tracked in-code — it must land here or as a story |
| Review artifacts (reviewed/bounced) | 4 | `backlog/.workflow/review-*.json` — review-check gate is in active use |

## Hotspots (concentration × churn)

The files that are both **large** and **frequently changed** — the highest-risk
code and, for the flipped Scrum-Master lens, the **serialized-spine candidates**
(a shared hot file two agents both edit is a merge collision, not a parallel lane).

| File | LOC | Recent churn | Why it's a hotspot | Parallelization note |
|---|---|---|---|---|
| `src/store.ts` | 1398 | highest (app code) | monolithic Zustand store; touched by most feature work | **Spine** — serialize any stories that write it; a good split-along-domain candidate |
| `src/lib/market.ts` | 1235 | med | the rule/market engine; concentration of core logic (see `workflow/docs/engine-restructure-plan.md`) | **Spine** until restructured; contract-first before fan-out |
| `src/components/detail/StockDetail.tsx` | 736 | med | large, churny UI surface | Usually its own lane (disjoint files) once store contracts are fixed |
| `src/lib/client/marketClient.ts` | 277 | med | client/data boundary; timeout/async edges | Watch: async/error-state rework class |

## Debt / risk register

Severity is a first-pass guess (`low` / `med` / `high`); the Dev-team lens
re-scores. Each item should become SAD-anchorable to enter a sprint (an item with
no possible `sad_refs` is an IDEA for the Vision gate, not a story).

| id | area | severity | signal | proposed action | anchor |
|---|---|---|---|---|---|
| TH-1 | `src/store.ts` size/coupling | med | 1398 LOC + top churn; central coupling point | slice the store by domain; define per-slice contracts first | (dev-team to anchor) |
| TH-2 | rule engine `src/lib/market.ts` | med | 1235 LOC; core logic concentration | execute the existing `engine-restructure-plan.md` as a contract-first spine | SAD-002 (engine) |
| TH-3 | test coverage measurement | med | no line-coverage number exists | add `vitest run --coverage`, set a floor, surface it here next survey | — |
| TH-4 | async / error-state discipline | med | the STORY-018 rework class; client timeout edges (`marketClient.ts`) | keep as a standing review-check watch item; fan specialist reviewers on these lanes | — |
| TH-5 | in-code debt visibility | low | 0 TODO/FIXME markers — debt is invisible in-code | adopt a convention: real debt lands here or as a `techdebt` story, not silent | — |
| TH-6 | Python tooling deps | low | `workflow/tools/*.py` has no pinned deps file | note the interpreter/deps expectations; low urgency | — |

## Dependency / stack notes

TypeScript/React front end (`src/`) + Node/TS server (`server/`) + TS/Python tooling
(`tools/`, `workflow/tools/`). React 19 / Vite 8 / Vitest 4 / TS 6 per `package.json`.
No dependency item is currently flagged as risk; revisit on any major-version bump.

## How to refresh this register

Re-run the survey and apply the Dev-team lens's retro recommendations:

```bash
# test-vs-source
find src server tools -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' | wc -l
find src server tools tests -type f -name '*.test.*' | wc -l
# debt markers
grep -rnE "TODO|FIXME|HACK|XXX" src server tools --include=*.ts --include=*.tsx | wc -l
# hotspots: size
find src server tools -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' | xargs wc -l | sort -rn | head
# hotspots: churn
git log --pretty=format: --name-only -n 80 | grep -E '^(src|server|tools)/' | sort | uniq -c | sort -rn | head
# real coverage (once TH-3 is done)
npx vitest run --coverage
```

_Future automation option: a `/tech-survey` command (like `/sync-board`) could
regenerate the Snapshot + Hotspots tables from these commands, leaving the
Dev-team lens to own severity and actions._
