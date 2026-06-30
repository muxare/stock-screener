#!/usr/bin/env python3
"""SessionStart re-grounding hook (C-1).

Our state lives on disk (board folders, frontmatter, the SAD), so the
conversation is disposable: we can `/clear` or `/compact` freely and re-hand the
agent the disk-truth on the next turn. This hook fires on SessionStart and
injects `additionalContext` describing the active sprint, WIP, and the
in-progress story (its sad_refs, reject_reason, Touch scope) so a fresh window
resumes fully grounded instead of losing the thread.

Wired in .claude/settings.json under `SessionStart`. Passive: it NEVER blocks a
session and ALWAYS exits 0. Kill-switch: SESSION_GROUND=0 (or the shared
SAD_WF_LOG=0).
"""
from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys

# Re-ground on the events that drop or rewrite the window. (startup included so a
# brand-new session also opens grounded.)
GROUND_ON = {"clear", "compact", "resume", "startup"}


def _root() -> str:
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env and os.path.isdir(env):
        return env
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _enabled() -> bool:
    for var in ("SESSION_GROUND", "SAD_WF_LOG"):
        if os.environ.get(var, "1").strip().lower() in ("0", "false", "no", "off"):
            return False
    return True


def _board(root: str, *args: str) -> str:
    try:
        out = subprocess.run(
            [sys.executable, os.path.join(root, "tools", "board.py"), *args],
            cwd=root, capture_output=True, text=True, timeout=15,
            env=dict(os.environ, SAD_WF_LOG="0"),  # reads must not pollute the log
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _frontmatter(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.DOTALL)
    fm = {}
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                fm[k.strip()] = re.sub(r"\s+#.*$", "", v).strip()
    return fm


def _section(text: str, name: str) -> str:
    """Return the body lines under a `## <name>` / `**<name>**` heading, trimmed."""
    m = re.search(rf"(?:^#{{1,6}}\s*|\*\*){re.escape(name)}\b.*?\n(.*?)(?:\n#{{1,6}}\s|\n\*\*|\Z)",
                  text, re.IGNORECASE | re.DOTALL)
    if not m:
        return ""
    lines = [ln.rstrip() for ln in m.group(1).strip().splitlines() if ln.strip()]
    return "\n".join(lines[:8])


def _in_progress(root: str) -> list[str]:
    blocks = []
    for p in sorted(glob.glob(os.path.join(root, "backlog", "board", "in-progress", "STORY-*.md"))):
        try:
            text = open(p, encoding="utf-8").read()
        except Exception:
            continue
        fm = _frontmatter(text)
        sid = fm.get("id") or os.path.basename(p)[:-3]
        parts = [f"### {sid}  (in-progress)"]
        if fm.get("capability"):
            parts.append(f"- capability: {fm['capability']}")
        if fm.get("sad_refs"):
            parts.append(f"- sad_refs: {fm['sad_refs']}  (read ONLY these anchors)")
        rr = (fm.get("reject_reason") or "").strip()
        if rr and rr not in ("~", "", "None", "[]"):
            parts.append(f"- ⚠ reject_reason (address FIRST): {rr}")
        scope = _section(text, "Touch scope")
        if scope:
            parts.append("- Touch scope:\n" + "\n".join("    " + ln for ln in scope.splitlines()))
        blocks.append("\n".join(parts))
    return blocks


def main() -> None:
    try:
        raw = sys.stdin.read() or "{}"
        payload = json.loads(raw)
    except Exception:
        payload = {}
    source = str(payload.get("source", "startup")).strip().lower()
    if not _enabled() or source not in GROUND_ON:
        sys.exit(0)

    root = _root()
    sprint = _board(root, "sprint-show")
    in_prog = _in_progress(root)

    chunks = ["# Workflow re-grounding (disk is the source of truth)",
              "_Injected by the SessionStart hook so this fresh window resumes grounded._"]
    if sprint:
        chunks.append("## Active sprint / WIP\n" + sprint)
    if in_prog:
        chunks.append("## In-progress stories\n" + "\n\n".join(in_prog))
        chunks.append("Before coding: invoke `sad-grounding`, read the cited sad_refs, "
                      "restate the binding constraints, and stay inside Touch scope.")
    else:
        chunks.append("No story is in-progress. Read `python tools/board.py batch-list` "
                      "/ `sprint-show` before starting work; only build inside the active batch.")
    context = "\n\n".join(chunks)

    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context,
    }}))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)  # never break a session
