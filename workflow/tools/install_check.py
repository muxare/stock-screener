#!/usr/bin/env python3
"""Verify SAD-grounded workflow installation in the current repo root."""
from __future__ import annotations

import os
import stat
import subprocess
import sys

import workflow_log

ROOT = workflow_log.project_root()
BOARD = os.path.join(ROOT, "backlog", "board")
COLUMNS = ["todo", "in-progress", "review", "done", "blocked"]
BOARD_PY = os.path.join(ROOT, "workflow", "tools", "board.py")
HOOK = os.path.join(ROOT, "workflow", "hooks", "guard_board_mutation.py")
SAD_TEMPLATE = os.path.join(ROOT, "backlog", "sad", "SAD.template.md")
STORY_TEMPLATE = os.path.join(ROOT, "backlog", "stories", "STORY.template.md")
EPIC_TEMPLATE = os.path.join(ROOT, "backlog", "epics", "EPIC.template.md")
FEAT_TEMPLATE = os.path.join(ROOT, "backlog", "features", "FEAT.template.md")
IDEA_TEMPLATE = os.path.join(ROOT, "backlog", "ideas", "IDEA.template.md")
PLAN_TEMPLATE = os.path.join(ROOT, "backlog", "plans", "PLAN.template.md")


def ok(msg: str) -> None:
    print(f"  ok: {msg}")


def warn(msg: str) -> None:
    print(f"  warn: {msg}")


def fail(msg: str) -> None:
    print(f"  FAIL: {msg}")


def is_executable(path: str) -> bool:
    try:
        mode = os.stat(path).st_mode
        return bool(mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))
    except OSError:
        return False


def main() -> int:
    print("SAD workflow install check\n")
    problems = 0

    for col in COLUMNS:
        col_dir = os.path.join(BOARD, col)
        if os.path.isdir(col_dir):
            ok(f"column folder backlog/board/{col}/")
        else:
            fail(f"missing column folder backlog/board/{col}/")
            problems += 1

    for label, path in (
        ("board.py", BOARD_PY),
        ("guard hook", HOOK),
        ("SAD template", SAD_TEMPLATE),
        ("IDEA template", IDEA_TEMPLATE),
        ("PLAN template", PLAN_TEMPLATE),
        ("story template", STORY_TEMPLATE),
        ("epic template", EPIC_TEMPLATE),
        ("feature template", FEAT_TEMPLATE),
    ):
        if os.path.isfile(path):
            ok(f"{label} present")
        else:
            fail(f"missing {path}")
            problems += 1

    for label, path in (("board.py", BOARD_PY), ("guard hook", HOOK)):
        if os.path.isfile(path) and not is_executable(path):
            warn(f"{label} not executable — run: chmod +x {os.path.relpath(path, ROOT)}")

    print("\nRunning board validate…")
    proc = subprocess.run(
        [sys.executable, BOARD_PY, "validate"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    print(proc.stdout.rstrip())
    if proc.returncode != 0:
        if proc.stderr:
            print(proc.stderr.rstrip())
        problems += 1

    print("\nNext steps:")
    print("  1. Copy a starter idea → backlog/ideas/IDEA-001.md (see workflow/docs/ideas/)")
    print("  2. /refine-idea IDEA-001 PLAN-001 → /plan-to-sad PLAN-001 SAD-001")
    print("  3. /sad-to-backlog SAD-001 then /build-toward <capability>")
    print("  4. See examples/taskledger/ for a populated reference")
    print("  5. python3 -m pip install -r requirements-dev.txt && pytest")

    if problems:
        print(f"\nInstall check finished with {problems} problem(s).")
        import workflow_log

        workflow_log.log_event("install", "check", outcome="refused", count=problems)
        return 1
    print("\nInstall check passed.")
    import workflow_log

    workflow_log.log_event("install", "check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
