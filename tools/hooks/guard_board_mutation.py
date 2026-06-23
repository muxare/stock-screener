#!/usr/bin/env python3
"""Block manual kanban board mutations — use tools/board.py instead.

Used as a PreToolUse / beforeShellExecution hook. Reads JSON from stdin.
Exit 0 to allow; exit 2 to deny (Claude Code and Cursor).
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Optional

BOARD_STORY = re.compile(
    r"backlog/board/(?:todo|in-progress|review|done|blocked)/STORY-\d+\.md$"
)
BOARD_PY = re.compile(
    r"(?:^|[\s'\"])(?:python3?\s+)?(?:\./)?tools/board\.py\b"
)


def normalize_path(path: str) -> str:
    p = path.replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    return p


def is_board_story_path(path: str) -> bool:
    return bool(BOARD_STORY.search(normalize_path(path)))


def is_board_py_command(command: str) -> bool:
    return bool(BOARD_PY.search(command))


def check_shell_command(command: str) -> Optional[str]:
    """Return denial reason, or None if allowed."""
    cmd = command.strip()
    if not cmd or is_board_py_command(cmd):
        return None

    norm = cmd.replace("\\", "/")
    touches_board_story = "backlog/board/" in norm and "STORY-" in norm

    if touches_board_story and re.search(r"\b(mv|cp|git\s+mv)\b", cmd):
        return (
            "Blocked: move story files manually. "
            "Use: python tools/board.py move <id> <column>"
        )
    if touches_board_story and re.search(r"\brm\b", cmd):
        return "Blocked: delete story files manually."
    return None


def check_delete_path(file_path: str) -> Optional[str]:
    if is_board_story_path(file_path):
        return "Blocked: delete story files manually. Use board.py to manage stories."
    return None


def parse_hook_input(raw: str) -> tuple[str, dict]:
    """Return (event_kind, payload) from Cursor or Claude Code hook JSON."""
    if not raw.strip():
        return "empty", {}

    data = json.loads(raw)

    # Cursor beforeShellExecution
    if "command" in data and "tool_name" not in data and "toolName" not in data:
        return "shell", {"command": data["command"]}

    tool = data.get("tool_name") or data.get("toolName") or ""
    tool_input = (
        data.get("tool_input")
        or data.get("toolInput")
        or data.get("input")
        or {}
    )
    if not isinstance(tool_input, dict):
        tool_input = {}

    command = tool_input.get("command") or data.get("command") or ""
    file_path = tool_input.get("file_path") or tool_input.get("path") or ""

    return "tool", {"tool": tool, "command": command, "file_path": file_path}


def evaluate(payload: dict, event_kind: str) -> Optional[str]:
    if event_kind == "shell":
        return check_shell_command(payload.get("command", ""))

    tool = payload.get("tool", "")
    if tool in ("Bash", "Shell", "shell"):
        return check_shell_command(payload.get("command", ""))
    if tool in ("Delete", "delete"):
        return check_delete_path(payload.get("file_path", ""))
    return None


def main() -> None:
    raw = sys.stdin.read()
    try:
        event_kind, payload = parse_hook_input(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    reason = evaluate(payload, event_kind)
    if reason:
        tools_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)
        try:
            import workflow_log

            workflow_log.log_event("hook", "guard", outcome="refused", message=reason[:200])
        except Exception:
            pass
        print(reason, file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
