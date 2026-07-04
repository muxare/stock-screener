#!/usr/bin/env python3
"""Observability hook: record every interaction with the backlog system.

Wired as a PreToolUse and UserPromptSubmit hook. Reads the hook JSON from
stdin and appends a structured event to the shared workflow audit log
(`.workflow/events.jsonl`, via workflow/tools/workflow_log.py) whenever:

  * a backlog **skill** runs        (backlog-decomposer, idea-refiner, ...)
  * a backlog **slash command** is submitted  (/sad-to-backlog, /build-toward, ...)
  * a **file** under backlog/ is read / written / edited / globbed / grepped
  * a **Bash** command references backlog/

This is purely passive: it NEVER blocks a tool and ALWAYS exits 0. The point is
to reconstruct the authoring workflow (sequence + timing of skill/command/file
interactions) so the backlog system can be refined.

Inspect with:  python workflow/tools/board.py logs --tool skill   (or command / file / bash)
Disable with:  SAD_WF_LOG=0  (shared kill-switch) or BACKLOG_LOG=0
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

# --- backlog vocabulary ------------------------------------------------------

BACKLOG_SKILLS = {
    "backlog-decomposer",
    "idea-refiner",
    "poc-to-plan",
    "sad-author",
    "sad-grounding",
    "story-syncer",
}

# slash commands that drive the backlog pipeline (.claude/commands/*.md)
BACKLOG_COMMANDS = {
    "refine-idea",
    "plan-to-sad",
    "poc-to-plan",
    "sad-to-backlog",
    "build-toward",
    "sync-board",
}

# backlog/<subdir>/ -> artifact kind
ARTIFACT_BY_DIR = {
    "ideas": "idea",
    "plans": "plan",
    "sad": "sad",
    "epics": "epic",
    "features": "feature",
    "stories": "story",
    "board": "board",
}

# workflow/tools/<name>.py that already self-log via workflow_log -> don't double-count
SELF_LOGGING_TOOLS = (
    "workflow/tools/board.py",
    "workflow/tools/sync_board.py",
    "workflow/tools/workflow_log.py",
)

ID_RE = re.compile(r"\b(STORY|SAD|PLAN|EPIC|FEATURE|IDEA)-\d+\b", re.IGNORECASE)
SLASH_RE = re.compile(r"(?:^|\s)/([a-z][a-z0-9-]+)\b")


# --- helpers -----------------------------------------------------------------


def enabled() -> bool:
    for var in ("SAD_WF_LOG", "BACKLOG_LOG"):
        flag = os.environ.get(var, "1").strip().lower()
        if flag in ("0", "false", "no", "off"):
            return False
    return True


def normalize(path: str) -> str:
    p = (path or "").replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    return p


# 'backlog/' as a path segment: at string-start, or after / space quote — but
# not glued to a word ("mybacklog/"). Lookbehind keeps .end() right after it,
# so it works for paths ("backlog/x", "/abs/backlog/x") and shell command
# tokens alike ("grep x backlog/x").
BACKLOG_SEG = re.compile(r"(?<![\w-])backlog/")


def backlog_index(path: str) -> int:
    """Index just past 'backlog/' in path, or -1 if not a backlog path."""
    m = BACKLOG_SEG.search(normalize(path))
    return m.end() if m else -1


def classify(path: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (artifact_kind, ref_id) for a backlog path, else (None, ...)."""
    idx = backlog_index(path)
    if idx < 0:
        return None, _first_id(path)
    norm = normalize(path)
    rest = norm[idx:]
    subdir = rest.split("/", 1)[0] if "/" in rest else rest
    return ARTIFACT_BY_DIR.get(subdir, "backlog"), _first_id(norm)


def _first_id(text: str) -> Optional[str]:
    m = ID_RE.search(text or "")
    return m.group(0).upper() if m else None


def paths_from_input(tool: str, tool_input: Dict[str, Any]) -> List[str]:
    candidates: List[str] = []
    for key in ("file_path", "path", "notebook_path", "pattern"):
        val = tool_input.get(key)
        if isinstance(val, str) and val:
            candidates.append(val)
    # Glob/Grep scope their search with `path`; pattern alone rarely names backlog
    return candidates


def emit(tool: str, event: str, **fields: Any) -> None:
    # hooks live in workflow/hooks/; workflow_log lives in workflow/tools/.
    tools_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"
    )
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
    try:
        import workflow_log

        clean = {k: v for k, v in fields.items() if v not in (None, "")}
        workflow_log.log_event(tool, event, outcome="observed", **clean)
    except Exception:
        # observability must never break the session
        pass


# --- parsing -----------------------------------------------------------------


def parse(raw: str) -> Tuple[str, str, Dict[str, Any], str]:
    """Return (event_name, tool_name, tool_input, prompt)."""
    data = json.loads(raw)
    event_name = data.get("hook_event_name") or data.get("hookEventName") or ""
    tool = data.get("tool_name") or data.get("toolName") or ""
    tool_input = data.get("tool_input") or data.get("toolInput") or data.get("input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}
    prompt = data.get("prompt") or ""
    return event_name, tool, tool_input, prompt


# --- handlers ----------------------------------------------------------------


def handle_prompt(prompt: str) -> None:
    """Log backlog slash commands the user submits directly."""
    for m in SLASH_RE.finditer(prompt):
        name = m.group(1)
        if name in BACKLOG_COMMANDS:
            tail = prompt[m.end():].strip()
            emit("command", name, args=tail[:120] or None, ref=_first_id(prompt), source="prompt")


def handle_tool(tool: str, tool_input: Dict[str, Any]) -> None:
    # 1. Skill invocations
    if tool == "Skill":
        skill = (tool_input.get("skill") or "").strip()
        base = skill.split(":")[-1]  # strip any plugin: namespace
        if base in BACKLOG_SKILLS:
            args = tool_input.get("args") or ""
            emit("skill", base, args=str(args)[:120] or None, ref=_first_id(str(args)))
        return

    # 2. Subagents pointed at the backlog
    if tool in ("Task", "Agent"):
        prompt = str(tool_input.get("prompt") or "")
        if backlog_index(prompt) >= 0 or "backlog" in prompt.lower():
            emit(
                "agent",
                tool_input.get("subagent_type") or "agent",
                desc=str(tool_input.get("description") or "")[:80] or None,
                ref=_first_id(prompt),
            )
        return

    # 3. Bash referencing backlog/ (skip self-logging tools)
    if tool == "Bash":
        cmd = str(tool_input.get("command") or "")
        if backlog_index(cmd) >= 0 and not any(t in cmd for t in SELF_LOGGING_TOOLS):
            artifact, ref = classify(cmd)
            emit("bash", "bash", artifact=artifact, ref=ref, command=cmd[:160])
        return

    # 4. File tools touching backlog/
    action = {
        "Read": "read",
        "Write": "write",
        "Edit": "edit",
        "MultiEdit": "edit",
        "NotebookEdit": "edit",
        "Glob": "glob",
        "Grep": "grep",
    }.get(tool)
    if not action:
        return
    for path in paths_from_input(tool, tool_input):
        if backlog_index(path) >= 0:
            artifact, ref = classify(path)
            emit("file", action, artifact=artifact, ref=ref, path=normalize(path))
            return  # one event per tool call is enough


def main() -> None:
    if not enabled():
        sys.exit(0)
    raw = sys.stdin.read()
    if not raw.strip():
        sys.exit(0)
    try:
        event_name, tool, tool_input, prompt = parse(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    try:
        if event_name == "UserPromptSubmit" or (prompt and not tool):
            handle_prompt(prompt)
        elif tool:
            handle_tool(tool, tool_input)
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
