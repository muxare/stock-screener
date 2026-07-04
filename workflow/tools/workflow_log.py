#!/usr/bin/env python3
"""Append-only workflow audit log (JSON Lines).

Events are written to `backlog/.workflow/events.jsonl`. Disable with
SAD_WF_LOG=0. Use `python workflow/tools/board.py logs` to inspect.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

_FILE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def project_root() -> str:
    """Resolve the data/repo root that holds ``backlog/``.

    Shared resolver imported by every engine entry point (board.py,
    sync_board.py, install_check.py) so the ``backlog/...`` joins keep pointing
    at the project data dir no matter where the engine files themselves live.

    Resolution order:
      1. ``CLAUDE_PROJECT_DIR`` env (set by Claude Code for hooks/tools)
      2. ``SAD_WF_ROOT`` env (explicit override; honored historically here)
      3. upward search from cwd for a ``backlog/`` marker (plain-terminal use)
      4. upward search from this file's location for a ``backlog/`` marker
      5. the ``dirname(dirname(__file__))`` climb, as a last resort
    """
    for var in ("CLAUDE_PROJECT_DIR", "SAD_WF_ROOT"):
        env = os.environ.get(var)
        if env and os.path.isdir(env):
            return env
    for start in (os.getcwd(), _FILE_ROOT):
        d = start
        while True:
            if os.path.isdir(os.path.join(d, "backlog")):
                return d
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    return _FILE_ROOT


# Back-compat alias: some callers historically read module-level ROOT.
ROOT = project_root()


def _repo_root() -> str:
    return project_root()


def log_dir() -> str:
    return os.path.join(_repo_root(), "backlog", ".workflow")


def log_file() -> str:
    return os.path.join(log_dir(), "events.jsonl")


def enabled() -> bool:
    flag = os.environ.get("SAD_WF_LOG", "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _git_context() -> Dict[str, str]:
    import subprocess

    ctx: Dict[str, str] = {}
    try:
        for key, cmd in (
            ("git_head", ["git", "rev-parse", "--short", "HEAD"]),
            ("git_branch", ["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        ):
            out = subprocess.run(cmd, cwd=_repo_root(), capture_output=True, text=True)
            if out.returncode == 0:
                ctx[key] = out.stdout.strip()
    except Exception:
        pass
    return ctx


def log_event(
    tool: str,
    event: str,
    outcome: str = "ok",
    message: str = "",
    **fields: Any,
) -> None:
    """Append one JSON line. Never raises to callers."""
    if not enabled():
        return
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "tool": tool,
        "event": event,
        "outcome": outcome,
        "pid": os.getpid(),
        **_git_context(),
    }
    if message:
        record["message"] = message
    for key, value in fields.items():
        if value is not None and value != "":
            record[key] = value
    try:
        path = log_file()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass


def read_events(
    *,
    tail: int = 50,
    tool: Optional[str] = None,
    event: Optional[str] = None,
    story_id: Optional[str] = None,
    outcome: Optional[str] = None,
) -> List[Dict[str, Any]]:
    if not os.path.exists(log_file()):
        return []
    rows: List[Dict[str, Any]] = []
    with open(log_file(), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if tool and row.get("tool") != tool:
                continue
            if event and row.get("event") != event:
                continue
            if outcome and row.get("outcome") != outcome:
                continue
            if story_id and row.get("story_id") != story_id:
                continue
            rows.append(row)
    if tail and len(rows) > tail:
        rows = rows[-tail:]
    return rows


def format_event(row: Dict[str, Any]) -> str:
    ts = row.get("ts", "?")[:19].replace("T", " ")
    parts = [
        ts,
        row.get("tool", "?"),
        row.get("event", "?"),
        row.get("outcome", "?"),
    ]
    if row.get("story_id"):
        parts.append(str(row["story_id"]))
    if row.get("from") and row.get("to"):
        parts.append(f"{row['from']}→{row['to']}")
    elif row.get("message"):
        parts.append(str(row["message"])[:80])
    return "  ".join(parts)


def print_events(rows: Iterable[Dict[str, Any]], as_json: bool = False) -> None:
    rows = list(rows)
    if as_json:
        print(json.dumps(rows, indent=2))
        return
    if not rows:
        print("(no log events)")
        return
    for row in rows:
        print(format_event(row))


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(prog="workflow_log.py")
    ap.add_argument("--tail", type=int, default=50)
    ap.add_argument("--tool")
    ap.add_argument("--event")
    ap.add_argument("--story")
    ap.add_argument("--outcome")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    print_events(
        read_events(
            tail=args.tail,
            tool=args.tool,
            event=args.event,
            story_id=args.story,
            outcome=args.outcome,
        ),
        as_json=args.json,
    )
