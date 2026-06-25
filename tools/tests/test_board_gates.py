#!/usr/bin/env python3
"""Black-box tests for the Phase 1 board.py gates (#1 hard review-check, #4
sanctioned check/set commands).

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
