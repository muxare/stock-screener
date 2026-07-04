# Engine restructure plan — `workflow/` engine, `backlog/` data, `.claude/` wiring

> **Status:** Phases 1–4 EXECUTED on branch `workflow/consolidate-structure`
> (Phases 1–3 in commit `37b7754`, 2026-07-03; Phase 4 reconciliation 2026-07-04). Only
> the optional subtree-split (Phase 5 tail) remains open.
> Deliberately run **outside** the sprint/board workflow (this is engine surgery, not
> product work). Based on a Claude Desktop plan, corrected against the actual code by a
> three-agent grounding pass on 2026-07-03.
>
> **Locked decisions:**
> 1. `*.template.md` files **stay in `backlog/`** (matches sad-wf; board.py already resolves
>    them from the data dir, so no template-resolution code change).
> 2. Root resolver = **`CLAUDE_PROJECT_DIR` → `SAD_WF_ROOT` → upward search from cwd** for a
>    marker. Reuses mechanisms already in `session_ground.py` and `workflow_log.py`; works both
>    inside Claude Code and in a plain terminal.
> 3. Execution scope not yet chosen — this doc covers the full arc; Mikael reviews before any move.
> 4. Executed scope (2026-07-03): Phases 1–3 in full, **including** the docs→`workflow/docs/`
>    move (memory pointers repointed).
> 5. Executed scope (2026-07-04): Phase 4 reconcile — verified `workflow/` is a strict
>    **superset** of sad-wf, so "fold divergences in" was a no-op (nothing upstream to pull).
>    The two restart-gated confirmations (settings hook paths in a fresh session, **agent
>    symlink-discovery**) also passed in this session. Only the optional subtree-split remains.

---

## ✅ Post-Phase-3 restart steps — all CONFIRMED (2026-07-04)

The three items that needed a fresh Claude Code session are done:

1. **Session restarted** — the SessionStart re-grounding hook fired from `workflow/hooks/`,
   confirming `.claude/settings.json`'s new hook paths are live.
2. **Discovery confirmed.** Workflow commands & skills list through the symlinks, and
   critically the workflow **subagents also resolve** — all 6 (`claude-code-leverage`,
   `code-reviewer`, `dev-team-lens`, `idea-triage`, `product-owner-lens`, `scrum-master-lens`)
   appear as available agent types this session, discovered via `.claude/agents → ../workflow/agents`.
   So the untested `.claude/agents` symlink **works**; no revert needed.
3. **Transition shim gone** — `tools/hooks` symlink no longer present, never committed.

**Phase 4** (reconcile vs `sad-wf`) is now executed too (see below). Only the optional
**subtree-split** remains open.

## Target structure

```
stock-screener/
├── workflow/                      ← THE ENGINE (future subtree-split root)
│   ├── tools/                     board.py, workflow_log.py, sync_board.py, install_check.py, tests/
│   ├── hooks/                     the 4 hook scripts
│   ├── commands/                  9 slash commands (source of truth)
│   ├── skills/                    6 skills (source of truth)
│   ├── agents/                    6 agents (source of truth)
│   ├── docs/                      work-process-analysis, ceremonies, autonomy-tiers, friction, ideas/
│   └── README.md                  engine front door + install instructions
│
├── backlog/                       ← PROJECT DATA (produced by the engine)
│   ├── board/ ideas/ plans/ sad/ epics/ features/ batches/ retros/ stories/
│   ├── *.template.md              STAYS HERE (8 templates, seeded per data dir)
│   ├── .workflow/                 events.jsonl, review-*.json  (moved in from repo root)
│   └── index.html                 already here; board.md relocates here too
│
└── .claude/                       ← thin WIRING layer only
    ├── commands/ → symlink → workflow/commands/
    ├── skills/   → symlink → workflow/skills/
    ├── agents/   → symlink → workflow/agents/
    └── settings.json              hook paths → workflow/hooks/
```

Principle: `workflow/` is the engine (liftable verbatim), `backlog/` is the single data root,
`.claude/` is only what Claude Code must discover on disk — symlinks bridge discovery to the
engine folder while keeping one source of truth.

**Not moving** (stock-screener *product*, not engine): `tools/eod-import/`, `tools/yahoo-fetch/`,
`tools/tsconfig.json`, `dev-market.db*`, `src/`, `server/`, `poc/`, `dist/`, `public/`.

---

## The one load-bearing change

All four engine files compute `ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))`
(board.py:74, workflow_log.py:15, sync_board.py:23, install_check.py:10). Today `tools/` sits at
the repo root, so `ROOT` = repo root. **Move the files to `workflow/tools/` and that same
expression resolves to `workflow/`** — every `backlog/...` join silently points at
`workflow/backlog/...`. Nothing errors; it reads/writes the wrong tree. This is the entire risk.

**Fix — one shared resolver** all four import (new helper, likely in `workflow_log.py` or a small
`engine_paths.py`):

```
def project_root():
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env and os.path.isdir(env):
        return env
    env = os.environ.get("SAD_WF_ROOT")          # already honored by workflow_log.py today
    if env and os.path.isdir(env):
        return env
    # walk up from cwd for a marker (backlog/ dir, or .git); fall back to __file__ climb
    d = os.getcwd()
    while True:
        if os.path.isdir(os.path.join(d, "backlog")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return <__file__-based fallback>
```

Then `ROOT` in each file becomes `project_root()`; every `backlog/...` constant is unchanged
downstream. Keep a separate `ENGINE_ROOT = dirname(__file__)`-style value only if engine-owned
files ever need locating (templates do **not** — they stay in `backlog/`).

---

## Grep-driven rename surface (from the grounding pass)

### Code — must edit by hand (path built programmatically, not a literal)
- `tools/sync_board.py:25` — `BOARD_PY = os.path.join(ROOT, "tools", "board.py")` → `workflow/tools`
- `tools/install_check.py:13-14` — `BOARD_PY`, `HOOK` (`tools/board.py`, `tools/hooks/guard_board_mutation.py`)
- `tools/hooks/guard_board_mutation.py:25-27` — regex matching literal command string `tools/board.py`
- `tools/hooks/log_backlog_interaction.py:61` — `SELF_LOGGING_TOOLS = ("tools/board.py", "tools/sync_board.py", "tools/workflow_log.py")`
- `tools/hooks/session_ground.py:46` — `os.path.join(root, "tools", "board.py")`
- `tools/tests/test_board_gates.py:44,161-162` — invocation string `"tools/board.py"` + copy-list `("board.py", "workflow_log.py")`

### Hook coupling to preserve
`guard_board_mutation.py` and `log_backlog_interaction.py` import `workflow_log` via a
`sys.path.insert` computed as `dirname(dirname(__file__))` (climb from `hooks/` to its parent).
`session_ground.py` falls back to a **3-level** `__file__` climb if `CLAUDE_PROJECT_DIR` is unset.
→ Keep hooks and `workflow_log.py` at the **same relative offset** after the move, or these break
silently (imports are wrapped in `try/except: pass` → degrades to "no logging", no error).

### settings.json — 5 string edits
All 5 hooks use `$CLAUDE_PROJECT_DIR/tools/hooks/*.py` (lines 9, 18, 27, 37, 47) → `workflow/hooks/*.py`.

### Docs / commands / skills / agents — ~76 references (mostly find-replace `tools/board.py`)
- `.claude/agents/` (11): claude-code-leverage, code-reviewer, idea-triage, product-owner-lens, scrum-master-lens
- `.claude/commands/` (15): build-toward, capture-idea, sad-to-backlog, sprint-plan, sprint-retro, sync-board
- `.claude/skills/` (23): backlog-decomposer, sad-grounding, story-syncer
- `docs/` (many): autonomy-tiers, sprint-ceremonies, work-process-analysis, workflow-friction-review, claude-code-api-leverage
- `backlog/` (26): FEAT-*.md "Create stories via" lines, some IDEA/RETRO — generated content; update or leave as historical

### Other data locations to resolve
- `board.md` — written to **repo root** (board.py:1693), not `backlog/`. Relocate write target to `backlog/board.md`.
- `index.html` — **already** at `backlog/index.html` (board.py:2288). No change.
- `.workflow/` — move under `backlog/.workflow/`; resolver + `workflow_log.log_dir()` follow automatically.
- `.sync/remote-state.json` (sync_board.py:24) — third data location. Decide: `backlog/.sync/` or leave at root.

---

## Phased plan

### Phase 0 — safety net ✅ DONE
- Branch off the workflow process: `workflow/restructure-engine-seam`. *(Executed on
  `workflow/consolidate-structure` — a differently-named branch, same intent.)*
- Baseline green: `python tools/board.py validate` and the two standalone test scripts
  (`workflow/tools/tests/test_board_*.py`, run directly — they don't use pytest). Recorded.

### Phase 1 — decouple root FIRST, before moving anything ✅ DONE
> Shipped `workflow_log.project_root()` (also honors a `__file__`-climb fallback that walks
> up for the `backlog/` marker, so it stays correct after the move). Test harness hardened to
> pin `CLAUDE_PROJECT_DIR`/`SAD_WF_ROOT` to the throwaway repo against env leakage.
- Add `project_root()`; route board.py / workflow_log.py / sync_board.py / install_check.py through it.
- Re-run tests with files still in place → must stay green. Isolates the risky change from the move.

### Phase 2 — collect the engine ✅ DONE
> Hooks landed at `workflow/hooks/` (not `workflow/tools/hooks/`), so their `workflow_log`
> import offset was changed to `dirname(dirname(__file__))/tools` rather than merely preserved.
> The test harness needed **no** change: tests moved to `workflow/tools/tests/`, so its
> `TOOLS = dirname(HERE)` auto-resolves and the temp-repo invocation stays `tools/board.py`.
- `git mv` the engine subset of `tools/` (board.py, workflow_log.py, sync_board.py, install_check.py, hooks/, tests/) into `workflow/`. Leave product tools behind.
- Update the 6 hardcoded cross-references, the 5 settings.json hook paths, the test harness copy-list/invocation.
- Verify hook import offsets preserved (`workflow_log` still importable from the two hooks).

### Phase 3 — thin the wiring ✅ DONE
> Did the moves as `git mv` (history-preserving) + **relative** symlinks. Reference sweep was
> 129 `tools/…` hits + 17 `docs/…` hits (idempotent scripts; this plan doc excluded, product
> tools untouched). `.sync/` → `backlog/.sync/`. Gotcha caught: the hooks recreated
> `backlog/.workflow/` before the `mv`, nesting the 985-event history one level deep — un-nested
> and merged in ts-order, no data lost. `.gitignore` + `MEMORY.md` pointers updated.
- `rm -rf` moved content from `.claude/{commands,skills,agents}`; replace with symlinks into `workflow/`.
- Grep-replace the ~76 `tools/board.py` doc references.
- Relocate `board.md` write target; move `.workflow/` under `backlog/`; decide `.sync/` home.

### Phase 4 — reconcile against sad-wf (the REAL drift source) ✅ DONE (2026-07-04)
> Correction to the Desktop plan: the drift is **not** vs `~/.claude/skills/` (zero overlap there).
> It's vs the sibling engine repo **`/Users/mikaelaxelsson/source/repos/sad-wf/`**, from which this
> repo was bootstrapped.
>
> **Reconciliation outcome: `workflow/` is a strict SUPERSET of sad-wf's engine.** A full diff
> of every overlapping skill and command (ignoring the expected `tools/` → `workflow/tools/`
> path rewrites from Phase 3) showed this repo is ahead on every substantive axis and behind on
> none — so "fold divergences into `workflow/skills/`" was a **no-op**: nothing upstream to pull.
>
> | Item | verdict |
> |---|---|
> | `sad-grounding` (109 vs 80) — same-defect-class carve-out, `board.py check`+edit-guard, auto-stamped `base_commit`, mandatory `code-reviewer` pass (STORY-018 lesson), auto-gated moves | **this ahead** |
> | `backlog-decomposer` — todo-column edit-guard clause | **this ahead** |
> | `build-toward` (163 vs 69) — Commit-gate / active-batch section | **this ahead** |
> | `story-syncer` — path-only diff | this ahead (paths correct here) |
> | `idea-refiner`, `sad-author`, `plan-to-sad`, `refine-idea`, `sad-to-backlog`, `sync-board` | **in sync** (modulo paths) |
> | `poc-to-plan`, `capture-idea`, `sprint-plan`, `sprint-retro`, all 6 agents | **this-only** (absent in sad-wf) |
>
> sad-wf's only unique content is its old `tools/board.py` paths — *wrong* for this repo, an
> inherent divergence (exactly the prefix-mapping "wrinkle" Phase 5's subtree-split flags), not
> drift to merge. sad-wf's working tree is also already dirty. The reverse-sync (bringing sad-wf
> up to this repo's engine) is therefore **not** Phase 4 work — it's the optional Phase 5
> subtree-split/push, left open by choice.
- ✅ Verified the project-local copies are authoritative; confirmed there are no upstream
  divergences to fold in (this repo supersedes sad-wf on all axes).

### Phase 5 — verify + subtree-split ✅ DONE (2026-07-04)
> Automated pass green: `validate`, `render`, `render-html`, `logs`, `metrics` (full
> 985-event history), both test scripts, `install_check`, and both mutating hooks verified
> refusing + logging from `workflow/hooks/`. The **restart-gated** confirmations
> (settings hook paths active in a new session, agent symlink-discovery) **passed 2026-07-04**
> (see the ✅ section up top).
>
> **Live pass (2026-07-04, this session):** `validate` green, `render` → `backlog/board.md`,
> `render-html` → `backlog/index.html` (55 stories). All 4 hooks confirmed firing live from
> `workflow/hooks/`: `session_ground` (SessionStart re-grounding injected), `log_backlog_interaction`
> (this session's `board.py` calls + the guard refusals all appended to `backlog/.workflow/events.jsonl`),
> `guard_board_mutation` (denies manual `mv`/checkbox-flip on active stories with exit 2 + logs the
> refusal, allows `board.py`; runs on every Bash call in-session), and `allow_localhost_curl` (allows
> localhost). A literal column move was **deliberately skipped** — all batches are closed, so it would
> mean opening a sprint purely to test; the full mutation path (guard → `board.py` → logging) is already
> exercised, so no extra signal.
- Optional subtree-split: **executed locally** — `git subtree split --prefix=workflow` →
  branch `engine-subtree-split-v2` (README-inclusive). The **push to sad-wf is blocked by the
  local `block-dangerous-git.sh` safety hook** (`git push` denied), so it's a hand-off, not
  auto-run. See "Subtree-split result" below.
  - **Wrinkle (still real, deferred to a merge design pass):** sad-wf ships `.claude/` at *its* root,
    but our `workflow/` holds `commands/skills/agents` (not under `.claude/`). The split tree is
    therefore *not* structurally mergeable into sad-wf `main` as-is — it should be parked in sad-wf
    on a **new branch** for a later remap, **never** merged straight to `main`.

#### Subtree-split result (2026-07-04)
- **Local split branch:** `engine-subtree-split-v2` at the repo root (an earlier `engine-subtree-split`
  predates the README and can be deleted). Top-level tree = `README.md agents commands docs hooks
  skills tools` — i.e. `workflow/`'s contents hoisted to root, no prefix. Verified with `git ls-tree`.
- **History depth = 2 commits.** A plain `--prefix` split does **not** follow the Phase-2/3 git-mv
  renames (pre-consolidation history lived under `tools/`, `docs/`, `.claude/`), so the split captures
  the engine as-of-consolidation only. Full-history rejoin would need a rename-following filter — out
  of scope; the current split is sufficient to seed/refresh sad-wf.
- **Added `workflow/README.md`** (engine front door) — the split exposed that the target structure
  named it but Phases 1–3 never created it.
- **Push (hand-off — blocked by safety hook):** run from a shell that allows `git push`:
  ```
  git push /Users/mikaelaxelsson/source/repos/sad-wf \
    engine-subtree-split-v2:refs/heads/engine-from-stock-screener
  ```
  This creates a **new** branch in sad-wf (`engine-from-stock-screener`); it does **not** touch
  sad-wf's `main` or its (currently dirty) working tree. Merging that branch into sad-wf `main`
  is the separate `.claude/`-remap design pass noted in the wrinkle above.

---

## Corrections to the original Desktop plan (summary)
1. Drift target is **sad-wf**, not `~/.claude/skills/` (no overlap there).
2. Templates **stay in `backlog/`** (board.py resolves from data dir; sad-wf ships them there) — do **not** move to `workflow/templates/`.
3. `tools/` is **mixed** — only the engine subset moves; `eod-import/`, `yahoo-fetch/` are product.
4. `board.md` is at **repo root** (needs a code edit to relocate); `index.html` is **already** under `backlog/`.
5. `.sync/remote-state.json` is a **third** data location the plan didn't account for.
6. Do the **root decoupling before the move** (Phase 1), so the one risky change is verified in isolation.
