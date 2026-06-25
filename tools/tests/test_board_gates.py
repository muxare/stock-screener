#!/usr/bin/env python3
"""Black-box tests for the board.py gates:
  Phase 1 — #1 hard review-check, #4 sanctioned check/set commands
  Phase 2 — #11 reject auto-demote
  Phase 3 — #6 WIP limits, #7 batch=Gate 3, #8 exception queue

Self-contained: builds a throwaway git repo + board in a tempdir, copies the
real board.py + workflow_log.py into it, and drives the actual CLI via
subprocess. No pytest required — run directly:

    python3 tools/tests/test_board_gates.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
COLUMNS = ["todo", "in-progress", "review", "done", "blocked"]

failures = []


def check(label, cond):
    print(("  PASS " if cond else "  FAIL ") + label)
    if not cond:
        failures.append(label)


class Repo:
    def __init__(self, root):
        self.root = root

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root,
                              capture_output=True, text=True)

    def board(self, *args):
        env = dict(os.environ, SAD_WF_LOG="0")
        return subprocess.run([sys.executable, "tools/board.py", *args],
                              cwd=self.root, capture_output=True, text=True, env=env)

    def story_path(self, sid):
        for col in COLUMNS:
            p = os.path.join(self.root, "backlog", "board", col, f"{sid}.md")
            if os.path.exists(p):
                return p
        return None

    def column_of(self, sid):
        p = self.story_path(sid)
        return os.path.basename(os.path.dirname(p)) if p else None

    def fm(self, sid, key):
        with open(self.story_path(sid), encoding="utf-8") as f:
            text = f.read()
        m = re.search(rf"^{re.escape(key)}:\s*(.*)$", text, re.MULTILINE)
        return m.group(1).strip() if m else None

    def body(self, sid):
        with open(self.story_path(sid), encoding="utf-8") as f:
            return f.read()

    def write_story(self, sid, column, sad_refs="[SAD#1.1]", scope="src/foo/**",
                    criteria=("first criterion alpha", "second criterion beta")):
        crit = "\n".join(f"- [ ] {c}" for c in criteria)
        text = f"""---
id: {sid}
type: story
parent: FEAT-001
capability: CAP-x
sad_refs: {sad_refs}
target: ~
estimate: ~
attempts: 0
prev_column: ~
blocked_reason: ~
---

## User Story
test story

## Acceptance Criteria
{crit}

## Touch scope
- {scope}
"""
        d = os.path.join(self.root, "backlog", "board", column)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{sid}.md"), "w", encoding="utf-8") as f:
            f.write(text)

    def write_batch(self, bid, status="active", wip_limit=3, capabilities="[CAP-x]"):
        text = (f"---\nid: {bid}\ntype: batch\nstatus: {status}\n"
                f"created: 2026-06-25\nwip_limit: {wip_limit}\n"
                f"capabilities: {capabilities}\n---\n\n## Goal\ntest batch\n")
        d = os.path.join(self.root, "backlog", "batches")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{bid}.md"), "w", encoding="utf-8") as f:
            f.write(text)

    def write_sad(self, caps=("CAP-x",)):
        lines = ["---", "id: SAD-001", "status: Approved", "---", "",
                 "## SAD#1 Scope", "anchor SAD#1.1", "", "## SAD#3 Capabilities"]
        for i, c in enumerate(caps, 1):
            lines.append(f"### SAD#3.{i} {c}: capability {c}")
        d = os.path.join(self.root, "backlog", "sad")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "SAD-001.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


def setup_repo(root):
    repo = Repo(root)
    for col in COLUMNS:
        os.makedirs(os.path.join(root, "backlog", "board", col), exist_ok=True)
    os.makedirs(os.path.join(root, "tools"), exist_ok=True)
    for fn in ("board.py", "workflow_log.py"):
        shutil.copy(os.path.join(TOOLS, fn), os.path.join(root, "tools", fn))
    repo.git("init", "-q")
    repo.git("config", "user.email", "t@t.t")
    repo.git("config", "user.name", "t")
    with open(os.path.join(root, ".gitignore"), "w") as f:
        f.write(".workflow/\n")
    repo.git("add", "-A")
    repo.git("commit", "-qm", "base")
    return repo


def run():
    tmp = tempfile.mkdtemp(prefix="board-gate-test-")
    try:
        repo = setup_repo(tmp)

        print("\n[#1] base_commit stamping + hard gate on move review")
        repo.write_story("STORY-100", "todo")
        r = repo.board("move", "STORY-100", "in-progress")
        check("move to in-progress succeeds", r.returncode == 0)
        bc = repo.fm("STORY-100", "base_commit")
        check("base_commit stamped on in-progress", bool(bc) and bc not in ("~", ""))
        check("attempts incremented to 1", repo.fm("STORY-100", "attempts") == "1")

        r = repo.board("move", "STORY-100", "review")
        check("move review REFUSED while criteria unchecked",
              r.returncode != 0 and "review-check" in (r.stdout + r.stderr))
        check("story stayed in in-progress", repo.column_of("STORY-100") == "in-progress")

        print("\n[#4] board.py check ticks criteria (sanctioned path)")
        r = repo.board("check", "STORY-100", "--all")
        check("check --all succeeds", r.returncode == 0)
        check("no unchecked boxes remain", "- [ ]" not in repo.body("STORY-100"))

        print("\n[#1] out-of-scope change blocks the gate")
        os.makedirs(os.path.join(tmp, "src", "other"), exist_ok=True)
        with open(os.path.join(tmp, "src", "other", "bad.py"), "w") as f:
            f.write("x = 1\n")
        r = repo.board("move", "STORY-100", "review")
        check("move review REFUSED on out-of-scope change",
              r.returncode != 0 and "Touch scope" in (r.stdout + r.stderr))

        print("\n[#1] in-scope change + ticked criteria passes the gate")
        os.remove(os.path.join(tmp, "src", "other", "bad.py"))
        os.makedirs(os.path.join(tmp, "src", "foo"), exist_ok=True)
        with open(os.path.join(tmp, "src", "foo", "ok.py"), "w") as f:
            f.write("y = 2\n")
        r = repo.board("move", "STORY-100", "review")
        check("move review SUCCEEDS when clean", r.returncode == 0)
        check("story now in review", repo.column_of("STORY-100") == "review")

        print("\n[#4] board.py set updates allowlisted frontmatter; rejects others")
        r = repo.board("set", "STORY-100", "sad_refs", "[SAD#9.9]")
        check("set sad_refs succeeds", r.returncode == 0)
        check("sad_refs updated", repo.fm("STORY-100", "sad_refs") == "[SAD#9.9]")
        r = repo.board("set", "STORY-100", "base_commit", "deadbeef")
        check("set base_commit REJECTED (not allowlisted)", r.returncode != 0)

        print("\n[#1] --skip-review-check is an explicit human override")
        repo.write_story("STORY-101", "todo")
        repo.board("move", "STORY-101", "in-progress")
        with open(os.path.join(tmp, "src", "other2.py"), "w") as f:
            f.write("z = 3\n")  # out of scope + criteria unchecked
        r = repo.board("move", "STORY-101", "review")
        check("override needed: plain move refused", r.returncode != 0)
        r = repo.board("move", "STORY-101", "review", "--skip-review-check")
        check("move review SUCCEEDS with --skip-review-check", r.returncode == 0)
        check("STORY-101 in review after override", repo.column_of("STORY-101") == "review")
        os.remove(os.path.join(tmp, "src", "other2.py"))

        print("\n[#1] legacy story without base_commit is refused with guidance")
        # place a story straight into review (simulating a pre-Phase-1 in-flight story)
        repo.write_story("STORY-102", "review")
        repo.board("check", "STORY-102", "--all")
        r = repo.board("move", "STORY-102", "done")
        check("move done REFUSED without base_commit",
              r.returncode != 0 and "base_commit" in (r.stdout + r.stderr))
        r = repo.board("move", "STORY-102", "done", "--base", "HEAD")
        check("move done SUCCEEDS with explicit --base", r.returncode == 0)

        print("\n[#4] check --criterion ticks a single matching criterion")
        repo.write_story("STORY-103", "todo")
        r = repo.board("check", "STORY-103", "--criterion", "beta")
        check("check --criterion succeeds", r.returncode == 0)
        body = repo.body("STORY-103")
        check("matched criterion ticked", "- [x] second criterion beta" in body)
        check("other criterion left unticked", "- [ ] first criterion alpha" in body)
        r = repo.board("check", "STORY-103", "--criterion", "nonexistent")
        check("check --criterion with no match errors", r.returncode != 0)

        print("\n[#11] reject auto-demotes a reviewed story back into the loop")
        repo.write_story("STORY-200", "todo")
        repo.board("move", "STORY-200", "in-progress")
        repo.board("check", "STORY-200", "--all")
        os.makedirs(os.path.join(tmp, "src", "foo"), exist_ok=True)
        with open(os.path.join(tmp, "src", "foo", "r.py"), "w") as f:
            f.write("r = 1\n")
        r = repo.board("move", "STORY-200", "review")
        check("STORY-200 reached review", r.returncode == 0 and repo.column_of("STORY-200") == "review")
        attempts_before = repo.fm("STORY-200", "attempts")
        r = repo.board("reject", "STORY-200", "--reason", "fix the edge case")
        check("reject succeeds", r.returncode == 0)
        check("reject returns story to in-progress", repo.column_of("STORY-200") == "in-progress")
        check("reject stamps reject_reason", repo.fm("STORY-200", "reject_reason") == "fix the edge case")
        check("reject increments attempts",
              repo.fm("STORY-200", "attempts") == str(int(attempts_before) + 1))

        print("\n[#11] reject_reason is cleared when the story is re-submitted to review")
        r = repo.board("move", "STORY-200", "review")
        check("re-entry to review succeeds (gate re-runs, passes)", r.returncode == 0)
        rr = repo.fm("STORY-200", "reject_reason")
        check("reject_reason cleared on move to review", rr in (None, "~", ""))

        print("\n[#11] reject is refused outside the review column")
        repo.write_story("STORY-201", "todo")
        r = repo.board("reject", "STORY-201", "--reason", "nope")
        check("reject refused when not in review",
              r.returncode != 0 and "not review" in (r.stdout + r.stderr))

        print("\n[#7] batch-new records a Gate-3 commitment (auto-numbered, active)")
        r = repo.board("batch-new", "--capabilities", "CAP-x,CAP-y",
                       "--goal", "ship the slice", "--wip", "5")
        check("batch-new succeeds", r.returncode == 0)
        bpath = os.path.join(tmp, "backlog", "batches", "BATCH-001.md")
        check("BATCH-001 created", os.path.exists(bpath))
        r = repo.board("batch-list")
        check("batch-list shows active batch", "BATCH-001" in r.stdout and "active" in r.stdout)

        print("\n[#7] only one active batch at a time")
        r = repo.board("batch-new", "--capabilities", "CAP-z")
        check("second active batch refused", r.returncode != 0 and "active batch already exists" in (r.stdout + r.stderr))
        r = repo.board("batch-close", "BATCH-001")
        check("batch-close succeeds", r.returncode == 0)
        r = repo.board("batch-new", "--capabilities", "CAP-z")
        check("batch-new succeeds once prior batch is closed", r.returncode == 0)
        repo.board("batch-close", "BATCH-002")  # leave no active batch → default WIP applies

        print("\n[#6] WIP: starting past the limit is allowed but SURFACED")
        # baseline in-progress here is 0 (earlier stories ended in review/done/todo)
        for n in range(300, 304):  # 300,301,302,303 → counts 1,2,3,4 with default limit 3
            repo.write_story(f"STORY-{n}", "todo")
            r = repo.board("move", f"STORY-{n}", "in-progress")
            if n == 303:
                check("4th in-progress move still succeeds (non-blocking)", r.returncode == 0)
                check("4th in-progress move warns about WIP", "WIP" in (r.stdout + r.stderr))
            elif n == 302:
                check("3rd in-progress move (at limit) does not warn", "WIP" not in (r.stdout + r.stderr))

        print("\n[#6] validate flags the WIP breach")
        r = repo.board("validate")
        check("validate reports WIP breach (4 > limit 3)",
              r.returncode != 0 and "WIP breach" in (r.stdout + r.stderr) and "limit 3" in (r.stdout + r.stderr))

        print("\n[#6] an active batch's wip_limit overrides the default")
        repo.write_batch("BATCH-010", status="active", wip_limit=5)
        r = repo.board("validate")
        check("no WIP breach when active batch raises the limit to 5",
              "WIP breach" not in (r.stdout + r.stderr))
        r = repo.board("batch-list")
        check("batch-list shows live in-progress count", "in-progress now: 4" in r.stdout)
        # tighten the cap below the live count → breach reappears
        repo.write_batch("BATCH-010", status="active", wip_limit=2)
        r = repo.board("validate")
        check("WIP breach reappears when batch tightens limit to 2",
              "WIP breach" in (r.stdout + r.stderr) and "limit 2" in (r.stdout + r.stderr))

        print("\n[#7] validate flags more than one active batch")
        repo.write_batch("BATCH-011", status="active", wip_limit=5)
        r = repo.board("validate")
        check("validate flags >1 active batch",
              "active batches" in (r.stdout + r.stderr))
        os.remove(os.path.join(tmp, "backlog", "batches", "BATCH-011.md"))

        print("\n[#7] validate flags an unknown batch capability against the SAD")
        repo.write_sad(caps=("CAP-x", "CAP-y"))
        repo.write_batch("BATCH-010", status="active", wip_limit=9, capabilities="[CAP-bogus]")
        r = repo.board("validate", "--sad", "SAD-001")
        check("validate flags unknown batch capability",
              "unknown capability CAP-bogus" in (r.stdout + r.stderr))
        # restore a valid, generously-capped active batch for the remaining tests
        repo.write_batch("BATCH-010", status="active", wip_limit=99, capabilities="[CAP-x]")

        print("\n[#8] exception queue splits decision vs process blocks")
        repo.write_story("STORY-400", "todo")
        repo.board("move", "STORY-400", "in-progress")
        repo.board("move", "STORY-400", "blocked", "--reason",
                   "ADR-008 vendor decision + legal sign-off pending")
        repo.write_story("STORY-401", "todo")
        repo.board("move", "STORY-401", "in-progress")
        repo.board("move", "STORY-401", "blocked", "--reason", "waiting on STORY-300 helper")
        r = repo.board("exceptions", "--json")
        check("exceptions --json lists blocked stories", r.returncode == 0)
        import json as _json
        rows = {row["id"]: row for row in _json.loads(r.stdout)}
        check("ADR/legal block classified as a human decision (Gate 2/5)",
              rows.get("STORY-400", {}).get("kind") == "decision")
        check("ordinary block classified as a process block",
              rows.get("STORY-401", {}).get("kind") == "process")
        r = repo.board("exceptions")
        check("human exceptions view groups the decision block",
              "NEEDS A HUMAN DECISION" in r.stdout and "STORY-400" in r.stdout)

        print("\n[#8] render surfaces batch, WIP, and the exception queue")
        r = repo.board("render")
        check("render succeeds", r.returncode == 0)
        board_md = open(os.path.join(tmp, "board.md"), encoding="utf-8").read()
        check("board.md shows the active batch", "Active batch:" in board_md)
        check("board.md shows WIP usage", "WIP " in board_md)
        check("board.md surfaces the exception queue", "Exception queue:" in board_md and "STORY-400" in board_md)

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    run()
