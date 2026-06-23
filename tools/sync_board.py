#!/usr/bin/env python3
"""sync_board.py — local-first backlog sync stub for GitHub / Azure DevOps.

The repo backlog is the source of truth. This tool prepares push/pull plans
and applies them through a pluggable backend. Default backend persists remote
state to `.sync/remote-state.json` for dry-run and testing without MCP.

MCP connectors (story-syncer skill) should call the same plan/apply functions
or shell out to this CLI after translating remote API responses to RemoteRecord.

Conflict rule on pull: remote column wins; local story body/criteria win.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_STATE = os.path.join(ROOT, ".sync", "remote-state.json")
BOARD_PY = os.path.join(ROOT, "tools", "board.py")

COLUMN_MAP = {
    "todo": "todo",
    "to do": "todo",
    "new": "todo",
    "in progress": "in-progress",
    "in-progress": "in-progress",
    "active": "in-progress",
    "review": "review",
    "done": "done",
    "closed": "done",
    "resolved": "done",
    "blocked": "blocked",
}


@dataclass
class LocalStory:
    id: str
    column: str
    capability: str = ""
    target: str = ""
    parent: str = ""
    sad_refs: str = ""
    type: str = "story"


@dataclass
class RemoteRecord:
    id: str
    column: str
    capability: str = ""
    target: str = ""
    parent: str = ""
    sad_refs: str = ""
    type: str = "story"
    remote_id: str = ""


@dataclass
class SyncPlan:
    push: List[RemoteRecord] = field(default_factory=list)
    pull_moves: List[dict] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)
    conflicts: List[str] = field(default_factory=list)


def normalize_column(value: str) -> str:
    key = (value or "").strip().lower()
    return COLUMN_MAP.get(key, value.strip())


def load_local_stories() -> List[LocalStory]:
    proc = subprocess.run(
        [sys.executable, BOARD_PY, "list", "--json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"error: board.py list failed: {proc.stderr.strip()}")
    rows = json.loads(proc.stdout or "[]")
    out = []
    for row in rows:
        out.append(
            LocalStory(
                id=row.get("id", ""),
                column=row.get("column", "todo"),
                capability=row.get("capability", ""),
                target=row.get("target", ""),
                parent=row.get("parent", ""),
                sad_refs=row.get("sad_refs", ""),
                type=row.get("type", "story"),
            )
        )
    return out


def local_to_remote(story: LocalStory) -> RemoteRecord:
    return RemoteRecord(
        id=story.id,
        column=story.column,
        capability=story.capability,
        target=story.target,
        parent=story.parent,
        sad_refs=story.sad_refs,
        type=story.type,
        remote_id=story.id,
    )


def plan_push(local: List[LocalStory], remote_index: Dict[str, RemoteRecord]) -> SyncPlan:
    plan = SyncPlan()
    for story in local:
        if not story.sad_refs or story.sad_refs.strip() in ("[]", "~"):
            plan.skipped.append(f"{story.id}: empty sad_refs")
            continue
        rec = local_to_remote(story)
        existing = remote_index.get(story.id)
        if existing and (
            existing.column == rec.column
            and existing.capability == rec.capability
            and existing.sad_refs == rec.sad_refs
        ):
            plan.skipped.append(f"{story.id}: unchanged")
            continue
        plan.push.append(rec)
    return plan


def plan_pull(
    local: List[LocalStory], remote_index: Dict[str, RemoteRecord]
) -> SyncPlan:
    plan = SyncPlan()
    local_by_id = {s.id: s for s in local}
    for rid, remote in remote_index.items():
        local_story = local_by_id.get(rid)
        if not local_story:
            plan.conflicts.append(f"{rid}: remote item has no local story file")
            continue
        remote_col = normalize_column(remote.column)
        if remote_col != local_story.column:
            plan.pull_moves.append(
                {
                    "id": rid,
                    "from": local_story.column,
                    "to": remote_col,
                    "reason": "remote column wins",
                }
            )
            if remote_col != remote.column:
                plan.conflicts.append(
                    f"{rid}: mapped remote state '{remote.column}' → '{remote_col}'"
                )
        else:
            plan.skipped.append(f"{rid}: column already aligned")
    return plan


class FileBackend:
    """File-backed remote mirror for stub/dry-run mode."""

    def __init__(self, path: str):
        self.path = path

    def load(self) -> Dict[str, RemoteRecord]:
        if not os.path.exists(self.path):
            return {}
        with open(self.path, encoding="utf-8") as f:
            raw = json.load(f)
        out = {}
        for item in raw.get("stories", []):
            rec = RemoteRecord(**item)
            out[rec.id] = rec
        return out

    def save_index(self, index: Dict[str, RemoteRecord]) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        payload = {"stories": [asdict(v) for v in sorted(index.values(), key=lambda r: r.id)]}
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)


def apply_push(plan: SyncPlan, backend: FileBackend, dry_run: bool) -> None:
    if not plan.push:
        print("push: nothing to send")
        return
    index = backend.load()
    for rec in plan.push:
        action = "would push" if dry_run else "pushed"
        print(f"  {action} {rec.id} column={rec.column} cap={rec.capability}")
        if not dry_run:
            index[rec.id] = rec
    if not dry_run:
        backend.save_index(index)


def apply_pull_moves(plan: SyncPlan, dry_run: bool) -> None:
    if not plan.pull_moves:
        print("pull: no column moves")
        return
    for move in plan.pull_moves:
        cmd = [
            sys.executable,
            BOARD_PY,
            "move",
            move["id"],
            move["to"],
            "--reason",
            move.get("reason", "sync pull"),
        ]
        action = "would run" if dry_run else "running"
        print(f"  {action}: {' '.join(cmd[2:])}")
        if not dry_run:
            proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            if proc.returncode != 0:
                print(proc.stdout + proc.stderr, file=sys.stderr)
                sys.exit(f"error: pull move failed for {move['id']}")


def print_summary(label: str, plan: SyncPlan) -> None:
    print(f"\n{label} summary:")
    print(f"  push/update: {len(plan.push)}")
    print(f"  pull moves:  {len(plan.pull_moves)}")
    print(f"  skipped:     {len(plan.skipped)}")
    if plan.conflicts:
        print("  conflicts:")
        for c in plan.conflicts:
            print(f"    - {c}")


def cmd_push(args):
    local = load_local_stories()
    backend = FileBackend(args.state_file)
    remote_index = backend.load()
    plan = plan_push(local, remote_index)
    apply_push(plan, backend, args.dry_run)
    print_summary("push", plan)
    import workflow_log

    workflow_log.log_event(
        "sync",
        "push",
        dry_run=args.dry_run,
        pushed=len(plan.push),
        skipped=len(plan.skipped),
        conflicts=len(plan.conflicts),
    )


def cmd_pull(args):
    local = load_local_stories()
    backend = FileBackend(args.state_file)
    remote_index = backend.load()
    plan = plan_pull(local, remote_index)
    apply_pull_moves(plan, args.dry_run)
    print_summary("pull", plan)
    import workflow_log

    workflow_log.log_event(
        "sync",
        "pull",
        dry_run=args.dry_run,
        moves=len(plan.pull_moves),
        skipped=len(plan.skipped),
        conflicts=len(plan.conflicts),
    )


def cmd_status(args):
    local = load_local_stories()
    backend = FileBackend(args.state_file)
    remote_index = backend.load()
    print(f"local stories: {len(local)}")
    print(f"remote mirror: {len(remote_index)} ({args.state_file})")
    for story in local:
        remote = remote_index.get(story.id)
        remote_col = remote.column if remote else "—"
        mark = " " if remote and remote.column == story.column else "!"
        print(f"  {mark} {story.id}: local={story.column} remote={remote_col}")


def main():
    ap = argparse.ArgumentParser(prog="sync_board.py")
    ap.add_argument("--state-file", default=DEFAULT_STATE)
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name, fn in (("push", cmd_push), ("pull", cmd_pull), ("status", cmd_status)):
        p = sub.add_parser(name)
        p.add_argument("--dry-run", action="store_true")
        p.set_defaults(fn=fn)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
