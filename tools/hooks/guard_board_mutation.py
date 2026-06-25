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
# Columns where a story's criteria / sad_refs are the *contract being measured*,
# so gate-critical mutations must go through board.py (logged), not direct edits.
# `todo` is the authoring column — direct edits there stay free.
STORY_COLUMN = re.compile(
    r"backlog/board/(todo|in-progress|review|done|blocked)/STORY-\d+\.md$"
)
ACTIVE_COLUMNS = {"in-progress", "review", "done", "blocked"}
BOARD_PY = re.compile(
    r"(?:^|[\s'\"])(?:python3?\s+)?(?:\./)?tools/board\.py\b"
)
CHECKBOX_STATE = re.compile(r"-\s*\[([ xX])\]")
PROTECTED_FM = re.compile(r"^\s*(sad_refs|capability|base_commit)\s*:", re.MULTILINE)
EDIT_TOOLS = ("Edit", "MultiEdit", "Write", "NotebookEdit")


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


def story_column(file_path: str) -> Optional[str]:
    m = STORY_COLUMN.search(normalize_path(file_path))
    return m.group(1) if m else None


def _touches_gate(old: str, new: str) -> Optional[str]:
    """Return a reason if this old->new fragment flips a checkbox or edits
    protected frontmatter; else None. Free-text body edits return None."""
    old, new = old or "", new or ""
    if CHECKBOX_STATE.findall(old) != CHECKBOX_STATE.findall(new):
        return "acceptance-criteria checkbox"
    if PROTECTED_FM.search(old) or PROTECTED_FM.search(new):
        return "protected frontmatter (sad_refs/capability/base_commit)"
    return None


def check_story_edit(tool: str, file_path: str, tool_input: dict) -> Optional[str]:
    """Guard direct edits to gate-critical content on an ACTIVE story file.

    `todo` (authoring) is unguarded. On active stories, flipping an acceptance
    checkbox or editing sad_refs/capability/base_commit must go through board.py
    so the `done` gate can't be self-certified by an unaudited edit.
    """
    col = story_column(file_path)
    if col is None or col not in ACTIVE_COLUMNS:
        return None

    hint = (
        " Tick criteria with `python tools/board.py check <id> --criterion \"...\"` "
        "and change sad_refs with `python tools/board.py set <id> sad_refs \"...\"`. "
        "Free-text notes can still be edited directly."
    )

    if tool == "Write":
        return (
            "Blocked: overwriting an active story file directly. Use board.py for "
            "criteria/sad_refs changes (or edit it while it's in todo)." + hint
        )

    if tool == "MultiEdit":
        for e in tool_input.get("edits", []) or []:
            if not isinstance(e, dict):
                continue
            reason = _touches_gate(e.get("old_string", ""), e.get("new_string", ""))
            if reason:
                return f"Blocked: direct edit of {reason} on an active story." + hint
        return None

    # Edit / NotebookEdit
    old = tool_input.get("old_string", "") or tool_input.get("old_source", "")
    new = (
        tool_input.get("new_string", "")
        or tool_input.get("new_source", "")
        or tool_input.get("content", "")
    )
    reason = _touches_gate(old, new)
    if reason:
        return f"Blocked: direct edit of {reason} on an active story." + hint
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
    file_path = (
        tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("notebook_path")
        or ""
    )

    return "tool", {
        "tool": tool,
        "command": command,
        "file_path": file_path,
        "tool_input": tool_input,
    }


def evaluate(payload: dict, event_kind: str) -> Optional[str]:
    if event_kind == "shell":
        return check_shell_command(payload.get("command", ""))

    tool = payload.get("tool", "")
    if tool in ("Bash", "Shell", "shell"):
        return check_shell_command(payload.get("command", ""))
    if tool in ("Delete", "delete"):
        return check_delete_path(payload.get("file_path", ""))
    if tool in EDIT_TOOLS:
        return check_story_edit(
            tool, payload.get("file_path", ""), payload.get("tool_input", {})
        )
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
