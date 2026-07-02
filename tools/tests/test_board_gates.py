#!/usr/bin/env python3
"""Black-box tests for the board.py gates:
  Phase 1 — #1 hard review-check, #4 sanctioned check/set commands
  Phase 2 — #11 reject auto-demote
  Phase 3 — #6 WIP limits, #7 batch=Commit gate, #8 exception queue

Self-contained: builds a throwaway git repo + board in a tempdir, copies the
real board.py + workflow_log.py into it, and drives the actual CLI via
subprocess. No pytest required — run directly:

    python3 tools/tests/test_board_gates.py
"""
import json
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

    def record_review(self, sid, verdict="clean", blocking=None):
        """Drive `board.py review-record` with a findings JSON on stdin (R-1)."""
        env = dict(os.environ, SAD_WF_LOG="0")
        payload = json.dumps({"verdict": verdict, "blocking": blocking or []})
        return subprocess.run(
            [sys.executable, "tools/board.py", "review-record", sid],
            cwd=self.root, capture_output=True, text=True, env=env, input=payload)

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
                    criteria=("first criterion alpha", "second criterion beta"),
                    parent="FEAT-001"):
        crit = "\n".join(f"- [ ] {c}" for c in criteria)
        text = f"""---
id: {sid}
type: story
parent: {parent}
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

    def write_sad(self, caps=("CAP-x",), status="Approved", oos_tokens=()):
        lines = ["---", "id: SAD-001", f"status: {status}", "---", "",
                 "## SAD#1 Context & Scope", "anchor SAD#1.1", ""]
        if oos_tokens:
            lines += ["### SAD#1.2 Out of scope (non-goals)"]
            lines += [f"- The `{t}` artifact is out of scope." for t in oos_tokens]
            lines += [""]
        lines += ["## SAD#3 Capabilities"]
        for i, c in enumerate(caps, 1):
            lines.append(f"### SAD#3.{i} {c}: capability {c}")
        d = os.path.join(self.root, "backlog", "sad")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "SAD-001.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_templates(self):
        """Minimal authoring templates so new-epic/feature/plan/sad can scaffold."""
        items = {
            ("epics", "EPIC"): "parent: ~\nsad: SAD-000",
            ("features", "FEAT"): "parent: EPIC-000",
            ("plans", "PLAN"): "parent: IDEA-000",
            ("sad", "SAD"): "parent: PLAN-000\nstatus: Draft",
        }
        for (sub, prefix), extra in items.items():
            d = os.path.join(self.root, "backlog", sub)
            os.makedirs(d, exist_ok=True)
            text = (f"---\nid: {prefix}-000\ntype: {prefix.lower()}\n{extra}\n---\n\n"
                    f"# {prefix}-000 — <title>\n\nScaffold body.\n")
            with open(os.path.join(d, f"{prefix}.template.md"), "w", encoding="utf-8") as f:
                f.write(text)

    def write_events(self, lines):
        """Seed a controlled .workflow/events.jsonl for the metrics retrospective."""
        d = os.path.join(self.root, ".workflow")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "events.jsonl"), "w", encoding="utf-8") as f:
            for obj in lines:
                f.write(json.dumps(obj) + "\n")


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
        repo.record_review("STORY-100")  # R-1: clean code-review artifact required
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
        r = repo.board("move", "STORY-101", "review", "--skip-review-check", "--skip-code-review")
        check("move review SUCCEEDS with --skip-review-check + --skip-code-review", r.returncode == 0)
        check("STORY-101 in review after override", repo.column_of("STORY-101") == "review")
        os.remove(os.path.join(tmp, "src", "other2.py"))

        print("\n[#1] legacy story without base_commit is refused with guidance")
        # place a story straight into review (simulating a pre-Phase-1 in-flight story)
        repo.write_story("STORY-102", "review")
        repo.board("check", "STORY-102", "--all")
        r = repo.board("move", "STORY-102", "done")
        check("move done REFUSED without base_commit",
              r.returncode != 0 and "base_commit" in (r.stdout + r.stderr))
        r = repo.board("move", "STORY-102", "done", "--base", "HEAD", "--skip-code-review")
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
        # #4: a 0-match must be diagnostic, not silent — list the real criteria
        out = r.stdout + r.stderr
        check("0-match lists available criteria", "second criterion beta" in out)
        check("0-match reports the matched count", "0 of 2 matched" in out)
        # #4: punctuation/whitespace in the query must not break the match, and a
        # criterion that wraps across physical lines must still be matchable.
        repo.write_story("STORY-104", "todo",
                         criteria=("runScreen() is sequenced\n      last-write-wins",))
        r = repo.board("check", "STORY-104", "--criterion", "sequenced last-write-wins")
        check("multi-line criterion with punctuation matches", r.returncode == 0)
        body = repo.body("STORY-104")
        check("wrapped criterion's box line is ticked", "- [x] runScreen() is sequenced" in body)

        print("\n[#11] reject auto-demotes a reviewed story back into the loop")
        repo.write_story("STORY-200", "todo")
        repo.board("move", "STORY-200", "in-progress")
        repo.board("check", "STORY-200", "--all")
        os.makedirs(os.path.join(tmp, "src", "foo"), exist_ok=True)
        with open(os.path.join(tmp, "src", "foo", "r.py"), "w") as f:
            f.write("r = 1\n")
        repo.record_review("STORY-200")
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
        repo.record_review("STORY-200")  # re-review the reworked diff
        r = repo.board("move", "STORY-200", "review")
        check("re-entry to review succeeds (gate re-runs, passes)", r.returncode == 0)
        rr = repo.fm("STORY-200", "reject_reason")
        check("reject_reason cleared on move to review", rr in (None, "~", ""))

        print("\n[#11] reject is refused outside the review column")
        repo.write_story("STORY-201", "todo")
        r = repo.board("reject", "STORY-201", "--reason", "nope")
        check("reject refused when not in review",
              r.returncode != 0 and "not review" in (r.stdout + r.stderr))

        print("\n[#7] batch-new records a Commit-gate commitment (auto-numbered, active)")
        r = repo.board("batch-new", "--capabilities", "CAP-x,CAP-y",
                       "--goal", "ship the slice", "--wip", "5")
        check("batch-new succeeds", r.returncode == 0)
        bpath = os.path.join(tmp, "backlog", "batches", "BATCH-001.md")
        check("BATCH-001 created", os.path.exists(bpath))
        r = repo.board("batch-list")
        check("batch-list shows active batch", "BATCH-001" in r.stdout and "active" in r.stdout)

        print("\n[#7] only one active batch at a time")
        r = repo.board("batch-new", "--capabilities", "CAP-z")
        check("second active batch refused", r.returncode != 0 and "already exists" in (r.stdout + r.stderr))
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
        check("ADR/legal block classified as a human decision (Exception gate)",
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
        check("board.md shows the active sprint", "Active sprint:" in board_md)
        check("board.md shows WIP usage", "WIP " in board_md)
        check("board.md surfaces the exception queue", "Exception queue:" in board_md and "STORY-400" in board_md)

        print("\n[render-html] self-contained site + SAD coverage")
        # A clean SAD with real sub-anchor *headings* so coverage has leaves to
        # score (the shared write_sad emits SAD#1.1 as body text, not a heading).
        sad_path = os.path.join(tmp, "backlog", "sad", "SAD-001.md")
        with open(sad_path, "w", encoding="utf-8") as f:
            f.write("---\nid: SAD-001\nstatus: Approved\n---\n\n"
                    "## SAD#1 Context & Scope\n### SAD#1.1 In scope\nbody\n"
                    "## SAD#3 Capabilities\n### SAD#3.1 CAP-x: a\n### SAD#3.2 CAP-y: b\n")
        repo.write_story("STORY-700", "todo", sad_refs="[SAD#1.1]")  # covers SAD#1.1
        r = repo.board("render-html")
        check("render-html succeeds", r.returncode == 0)
        idx = os.path.join(tmp, "backlog", "index.html")
        check("backlog/index.html written", os.path.exists(idx))
        html = open(idx, encoding="utf-8").read()
        m = re.search(r"const DATA = (\{.*?\});\n", html)
        check("embedded DATA json present", bool(m))
        data = json.loads(m.group(1))
        check("model carries stories + columns", bool(data["stories"]) and len(data["columns"]) == 5)
        cov = data["sad_coverage"]
        anchors = {a["id"]: a for a in cov["anchors"]}
        check("SAD#1.1 leaf is covered by its story",
              "STORY-700" in anchors.get("SAD#1.1", {}).get("story_ids", []))
        check("SAD#3.1 capability leaf is uncovered",
              "SAD#3.1" in anchors and not anchors["SAD#3.1"]["story_ids"])
        # STORY-100 was repointed to SAD#9.9 earlier — no such anchor → dangling.
        dangling = {d["ref"] for d in cov["dangling_refs"]}
        check("a ref with no matching anchor is flagged dangling", "SAD#9.9" in dangling)

        print("\n[render-html] validate nudges only when the site is stale")
        r = repo.board("validate")
        check("fresh site → no stale nudge", "index.html is stale" not in (r.stdout + r.stderr))
        os.utime(repo.story_path("STORY-100"), None)  # bump mtime past index.html
        r = repo.board("validate")
        check("changed board → stale nudge surfaces",
              "index.html is stale" in (r.stdout + r.stderr))

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_phase4():
    """Phase 4 — close the loop: #5 Definition of Ready, #9 metrics, #10 validate
    invariants, #14 auto-numbered scaffolding. Runs in its OWN clean repo so the
    exit-code assertions aren't muddied by state the main run() accumulates."""
    tmp = tempfile.mkdtemp(prefix="board-gate-p4-")
    try:
        repo = setup_repo(tmp)
        repo.write_templates()

        print("\n[#5] Definition of Ready blocks an unready start")
        # placeholder criteria + no real Touch scope, but sad_refs is non-empty
        repo.write_story("STORY-500", "todo", scope="<path/glob>",
                         criteria=("<criterion placeholder>",), parent="FEAT-000")
        r = repo.board("move", "STORY-500", "in-progress")
        check("move in-progress REFUSED when not ready",
              r.returncode != 0 and "Definition of Ready" in (r.stdout + r.stderr))
        check("STORY-500 stayed in todo", repo.column_of("STORY-500") == "todo")
        r = repo.board("move", "STORY-500", "in-progress", "--skip-ready")
        check("--skip-ready overrides the DoR gate", r.returncode == 0
              and repo.column_of("STORY-500") == "in-progress")

        print("\n[#5] a ready story (real criteria + scope) starts cleanly")
        repo.write_story("STORY-501", "todo", parent="FEAT-000")  # real criteria + scope
        r = repo.board("move", "STORY-501", "in-progress")
        check("ready story moves to in-progress", r.returncode == 0
              and repo.column_of("STORY-501") == "in-progress")

        print("\n[#9] metrics retrospective off a controlled event log")
        repo.write_events([
            ev("STORY-900", "todo", "in-progress", "2026-06-20T10:00:00+00:00"),
            ev("STORY-900", "in-progress", "review", "2026-06-20T12:00:00+00:00"),
            ev("STORY-900", "review", "done", "2026-06-20T13:00:00+00:00"),
            ev("STORY-901", "todo", "in-progress", "2026-06-20T09:00:00+00:00"),
            ev("STORY-901", "in-progress", "review", "2026-06-20T09:00:02+00:00"),
            ev("STORY-901", "review", "done", "2026-06-20T09:00:03+00:00"),
            {"ts": "2026-06-20T11:00:00+00:00", "tool": "board",
             "event": "review-check", "outcome": "refused", "story_id": "STORY-900"},
            {"ts": "2026-06-20T11:30:00+00:00", "tool": "board",
             "event": "review-check", "outcome": "ok", "story_id": "STORY-900"},
            {"ts": "2026-06-20T12:30:00+00:00", "tool": "board",
             "event": "reject", "outcome": "ok", "story_id": "STORY-900",
             "from": "review", "to": "in-progress"},
        ])
        r = repo.board("metrics", "--json")
        check("metrics --json succeeds", r.returncode == 0)
        m = json.loads(r.stdout)
        check("cycle excludes the instant story (n=1)", m["cycle"]["n"] == 1)
        check("median cycle is the 3h real story", m["cycle"]["median_s"] == 10800)
        check("demo-sweep flags the instant story (F7)",
              m["demo_sweep"] == ["STORY-901"])
        check("review-check refusal counted (1/2)",
              m["review_check"]["refused"] == 1 and m["review_check"]["runs"] == 2)
        check("bounce counted across stories that reached review",
              m["bounce"]["bounces"] == 1 and m["bounce"]["reached_review"] == 2)

        print("\n[#10] validate warns (non-blocking) on a non-Approved SAD")
        repo.write_sad(caps=("CAP-x",), status="Draft")
        repo.write_story("STORY-510", "todo", parent="FEAT-000")  # cap CAP-x, sad SAD#1.1
        r = repo.board("validate", "--sad", "SAD-001")
        out = r.stdout + r.stderr
        check("Draft SAD surfaces a warning", "not Approved" in out)
        check("Draft SAD does NOT fail validate", r.returncode == 0)

        print("\n[#10] validate flags a story scoped at an out-of-scope artifact")
        repo.write_sad(caps=("CAP-x",), status="Approved", oos_tokens=("dc-runtime",))
        repo.write_story("STORY-511", "todo", scope="src/dc-runtime/support.js", parent="FEAT-000")
        r = repo.board("validate", "--sad", "SAD-001")
        check("out-of-scope Touch scope is a violation",
              r.returncode != 0 and "out-of-scope" in (r.stdout + r.stderr)
              and "dc-runtime" in (r.stdout + r.stderr))
        os.remove(repo.story_path("STORY-511"))

        print("\n[#10] explicit deferral turns a coverage gap into a warning")
        repo.write_sad(caps=("CAP-x", "CAP-y"), status="Approved")
        r = repo.board("validate", "--sad", "SAD-001")
        check("uncovered CAP-y is a violation by default",
              r.returncode != 0 and "CAP-y: no story coverage" in (r.stdout + r.stderr))
        with open(os.path.join(tmp, "backlog", "deferred-capabilities.md"), "w") as f:
            f.write("# Deferred\n- CAP-y: parked until the vendor decision\n")
        r = repo.board("validate", "--sad", "SAD-001")
        out = r.stdout + r.stderr
        check("deferred CAP-y no longer fails validate", r.returncode == 0)
        check("deferred CAP-y is surfaced as a warning", "deferred" in out)

        print("\n[#10] a re-introduced ## Status section is warned about")
        sp = repo.story_path("STORY-510")
        with open(sp, "a", encoding="utf-8") as f:
            f.write("\n## Status\nDONE — stale prose\n")
        r = repo.board("validate", "--sad", "SAD-001")
        check("stale ## Status surfaces a warning",
              "stale `## Status`" in (r.stdout + r.stderr))

        print("\n[#14] new-epic / new-feature auto-number and scaffold")
        r = repo.board("new-epic", "--title", "First epic")
        check("new-epic creates EPIC-001", r.returncode == 0
              and os.path.exists(os.path.join(tmp, "backlog", "epics", "EPIC-001.md")))
        r = repo.board("new-epic", "--title", "Second epic")
        check("new-epic auto-increments to EPIC-002", r.returncode == 0
              and os.path.exists(os.path.join(tmp, "backlog", "epics", "EPIC-002.md")))
        r = repo.board("new-feature", "--title", "Orphan")
        check("new-feature without --parent is refused", r.returncode != 0)
        r = repo.board("new-feature", "--parent", "EPIC-001", "--title", "Real feature")
        fpath = os.path.join(tmp, "backlog", "features", "FEAT-001.md")
        check("new-feature with valid parent scaffolds FEAT-001",
              r.returncode == 0 and os.path.exists(fpath))
        if os.path.exists(fpath):
            ftext = open(fpath, encoding="utf-8").read()
            check("scaffolded feature records its parent epic", "parent: EPIC-001" in ftext)
            check("scaffolded feature title is set", "FEAT-001 — Real feature" in ftext)
        r = repo.board("new-feature", "--parent", "EPIC-099", "--title", "Bad parent")
        check("new-feature with a missing parent is refused", r.returncode != 0)
        r = repo.board("new-plan", "--title", "The plan")
        check("new-plan creates PLAN-001", r.returncode == 0
              and os.path.exists(os.path.join(tmp, "backlog", "plans", "PLAN-001.md")))
        r = repo.board("new-sad", "--parent", "PLAN-001", "--title", "Arch")
        check("new-sad auto-numbers SAD-002 (SAD-001 already exists)",
              r.returncode == 0
              and os.path.exists(os.path.join(tmp, "backlog", "sad", "SAD-002.md")))

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def ev(story, frm, to, ts):
    return {"ts": ts, "tool": "board", "event": "move", "outcome": "ok",
            "story_id": story, "from": frm, "to": to}


def run_phase_r1():
    """R-1: the code-review gate requires a fresh, clean code-reviewer artifact."""
    tmp = tempfile.mkdtemp(prefix="board-r1-test-")
    try:
        repo = setup_repo(tmp)
        os.makedirs(os.path.join(tmp, "src", "foo"), exist_ok=True)

        print("\n[R-1] move review REFUSED without a code-review artifact")
        repo.write_story("STORY-600", "todo")
        repo.board("move", "STORY-600", "in-progress")
        repo.board("check", "STORY-600", "--all")
        with open(os.path.join(tmp, "src", "foo", "a.py"), "w") as f:
            f.write("a = 1\n")
        r = repo.board("move", "STORY-600", "review")
        check("review refused with no code-review artifact",
              r.returncode != 0 and "code-review" in (r.stdout + r.stderr))
        check("story stayed in in-progress", repo.column_of("STORY-600") == "in-progress")

        print("\n[R-1] review-record then move review SUCCEEDS")
        r = repo.record_review("STORY-600")
        check("review-record succeeds", r.returncode == 0 and "clean" in r.stdout)
        r = repo.board("move", "STORY-600", "review")
        check("review SUCCEEDS with a clean, fresh artifact",
              r.returncode == 0 and repo.column_of("STORY-600") == "review")

        print("\n[R-1] a blocking verdict is refused (override available)")
        repo.write_story("STORY-601", "todo")
        repo.board("move", "STORY-601", "in-progress")
        repo.board("check", "STORY-601", "--all")
        with open(os.path.join(tmp, "src", "foo", "b.py"), "w") as f:
            f.write("b = 1\n")
        repo.record_review("STORY-601", verdict="blocking",
                           blocking=[{"where": "src/foo/b.py", "why": "bug"}])
        r = repo.board("move", "STORY-601", "review")
        check("review refused on a blocking verdict",
              r.returncode != 0 and "blocking" in (r.stdout + r.stderr))
        r = repo.board("move", "STORY-601", "review", "--skip-code-review")
        check("--skip-code-review overrides a blocking verdict", r.returncode == 0)

        print("\n[R-1] a stale artifact (HEAD moved on) is refused")
        repo.write_story("STORY-602", "todo")
        repo.board("move", "STORY-602", "in-progress")
        repo.board("check", "STORY-602", "--all")
        with open(os.path.join(tmp, "src", "foo", "c.py"), "w") as f:
            f.write("c = 1\n")
        repo.record_review("STORY-602")                       # recorded at current HEAD
        repo.git("commit", "--allow-empty", "-qm", "later")   # HEAD advances
        r = repo.board("move", "STORY-602", "review")
        check("review refused: artifact is stale (head mismatch)",
              r.returncode != 0 and "stale" in (r.stdout + r.stderr))

        print("\n[R-1] review-record refuses bad input")
        r = repo.record_review("STORY-602", verdict="bogus")
        check("review-record refuses an invalid verdict", r.returncode != 0)
        repo.write_story("STORY-603", "todo")  # never started -> no base_commit
        r = repo.record_review("STORY-603")
        check("review-record refuses a story without base_commit",
              r.returncode != 0 and "base_commit" in (r.stdout + r.stderr))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def report():
    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    run()
    run_phase4()
    run_phase_r1()
    report()
