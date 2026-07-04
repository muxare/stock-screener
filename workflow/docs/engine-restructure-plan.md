# Engine restructure plan — `workflow/` engine, `backlog/` data, `.claude/` wiring

> **Status:** PLAN ONLY — not yet executed. Deliberately run **outside** the sprint/board
> workflow (this is engine surgery, not product work). Based on a Claude Desktop plan,
> corrected against the actual code by a three-agent grounding pass on 2026-07-03.
>
> **Locked decisions:**
> 1. `*.template.md` files **stay in `backlog/`** (matches sad-wf; board.py already resolves
>    them from the data dir, so no template-resolution code change).
> 2. Root resolver = **`CLAUDE_PROJECT_DIR` → `SAD_WF_ROOT` → upward search from cwd** for a
>    marker. Reuses mechanisms already in `session_ground.py` and `workflow_log.py`; works both
>    inside Claude Code and in a plain terminal.
> 3. Execution scope not yet chosen — this doc covers the full arc; Mikael reviews before any move.

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

### Phase 0 — safety net
- Branch off the workflow process: `workflow/restructure-engine-seam`.
- Baseline green: `python tools/board.py validate` and `python -m pytest tools/tests` (or the project runner). Record output so later breakage is attributable.

### Phase 1 — decouple root FIRST, before moving anything
- Add `project_root()`; route board.py / workflow_log.py / sync_board.py / install_check.py through it.
- Re-run tests with files still in place → must stay green. Isolates the risky change from the move.

### Phase 2 — collect the engine
- `git mv` the engine subset of `tools/` (board.py, workflow_log.py, sync_board.py, install_check.py, hooks/, tests/) into `workflow/`. Leave product tools behind.
- Update the 6 hardcoded cross-references, the 5 settings.json hook paths, the test harness copy-list/invocation.
- Verify hook import offsets preserved (`workflow_log` still importable from the two hooks).

### Phase 3 — thin the wiring
- `rm -rf` moved content from `.claude/{commands,skills,agents}`; replace with symlinks into `workflow/`.
- Grep-replace the ~76 `tools/board.py` doc references.
- Relocate `board.md` write target; move `.workflow/` under `backlog/`; decide `.sync/` home.

### Phase 4 — reconcile against sad-wf (the REAL drift source)
> Correction to the Desktop plan: the drift is **not** vs `~/.claude/skills/` (zero overlap there).
> It's vs the sibling engine repo **`/Users/mikaelaxelsson/source/repos/sad-wf/`**, from which this
> repo was bootstrapped. Already diverged: `sad-grounding` (109 vs 80 lines — review-check gate,
> auto-stamped base_commit, mandatory code-reviewer pass never synced back), `backlog-decomposer`
> (todo-column edit-guard clause); `poc-to-plan` exists only here.
- Make the project-local copies authoritative; fold divergences into the canonical `workflow/skills/` set.

### Phase 5 — verify + (optional) subtree-split
- Live pass: `validate`, `render`, `render-html`, one real story move, confirm all 4 hooks fire and `events.jsonl` appends.
- Optional: `git subtree split --prefix=workflow` → push to sad-wf.
  - **Wrinkle:** sad-wf ships `.claude/` at *its* root, but our `workflow/` holds `commands/skills/agents`
    (not under `.claude/`). The prefix→sad-wf mapping isn't 1:1 and needs its own design pass before pushing.

---

## Corrections to the original Desktop plan (summary)
1. Drift target is **sad-wf**, not `~/.claude/skills/` (no overlap there).
2. Templates **stay in `backlog/`** (board.py resolves from data dir; sad-wf ships them there) — do **not** move to `workflow/templates/`.
3. `tools/` is **mixed** — only the engine subset moves; `eod-import/`, `yahoo-fetch/` are product.
4. `board.md` is at **repo root** (needs a code edit to relocate); `index.html` is **already** under `backlog/`.
5. `.sync/remote-state.json` is a **third** data location the plan didn't account for.
6. Do the **root decoupling before the move** (Phase 1), so the one risky change is verified in isolation.
