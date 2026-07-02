#!/usr/bin/env python3
"""Black-box tests for the sprint (Commit gate) ceremony layer in board.py:
  - sprint-plan-new enriches the batch (goal + committed stories + execution
    strategy + preparation/enablers) and stays single-active
  - legacy batch-new is still valid (additive fields)
  - validate: committed stories must be real & traceable; commitment drift warns;
    the prep firewall keeps groundwork ideas out of the build loop (capture≠commit)
  - sprint-show renders the goal + committed stories' live columns
  - sprint-close is an alias of batch-close

Reuses the throwaway-repo harness from test_board_gates. Run directly:

    python3 tools/tests/test_board_sprint.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_board_gates import (  # noqa: E402  (reuse the harness)
    Repo, setup_repo, check, report,
)
import tempfile  # noqa: E402
import shutil  # noqa: E402
import json  # noqa: E402


def out(r):
    return r.stdout + r.stderr


def run():
    tmp = tempfile.mkdtemp(prefix="board-sprint-test-")
    try:
        repo = setup_repo(tmp)
        # SAD with the capabilities the sprint commits to.
        repo.write_sad(caps=("CAP-x", "CAP-y"), status="Approved")

        print("\n[sprint-plan-new] enriches the batch (the Commit-gate commitment)")
        repo.write_story("STORY-200", "todo")  # capability CAP-x (harness default)
        r = repo.board("sprint-plan-new", "--capabilities", "CAP-x",
                       "--goal", "Ship a trustworthy screener",
                       "--stories", "STORY-200",
                       "--prep", "story:STORY-200,note:refresh golden master",
                       "--exec-strategy", "STORY-200 solo; reviewers fan out",
                       "--wip", "2")
        check("sprint-plan-new succeeds", r.returncode == 0)
        bpath = os.path.join(tmp, "backlog", "batches", "BATCH-001.md")
        btext = open(bpath, encoding="utf-8").read() if os.path.exists(bpath) else ""
        check("batch file written", bool(btext))
        check("status is active", "status: active" in btext)
        check("stories: frontmatter recorded", "stories: [STORY-200]" in btext)
        check("sprint goal recorded", "Ship a trustworthy screener" in btext)
        check("## Stories committed section present", "## Stories committed" in btext)
        check("## Execution strategy section present", "## Execution strategy" in btext)
        check("## Preparation / enablers section present",
              "## Preparation / enablers" in btext)
        check("prep note carried", "note:refresh golden master" in btext)

        print("\n[single-active] a second sprint is refused while one is active")
        r = repo.board("sprint-plan-new", "--capabilities", "CAP-y")
        check("second active sprint refused", r.returncode != 0
              and "already exists" in out(r))

        print("\n[sprint-show] surfaces goal + committed story's live column")
        r = repo.board("sprint-show")
        check("sprint-show succeeds", r.returncode == 0)
        check("shows the goal", "Ship a trustworthy screener" in r.stdout)
        check("shows committed story with its column",
              "STORY-200" in r.stdout and "todo" in r.stdout)

        print("\n[sprint-close] is an alias of batch-close")
        r = repo.board("sprint-close", "BATCH-001")
        check("sprint-close succeeds", r.returncode == 0)
        btext = open(bpath, encoding="utf-8").read()
        check("status flipped to closed", "status: closed" in btext)

        print("\n[legacy] batch-new without sprint fields stays valid + back-compat")
        r = repo.board("batch-new", "--capabilities", "CAP-y", "--goal", "legacy")
        check("legacy batch-new succeeds (no --stories)", r.returncode == 0)
        b2 = os.path.join(tmp, "backlog", "batches", "BATCH-002.md")
        b2text = open(b2, encoding="utf-8").read() if os.path.exists(b2) else ""
        check("legacy batch has no stories: field", "stories:" not in b2text)
        repo.board("sprint-close", "BATCH-002")

        print("\n[validate] committed story must be real & traceable")
        # Active sprint commits a story that does NOT exist on the board.
        r = repo.board("sprint-plan-new", "--capabilities", "CAP-x",
                       "--goal", "g", "--stories", "STORY-900", "--id", "BATCH-003")
        check("sprint with phantom committed story created", r.returncode == 0)
        r = repo.board("validate")
        check("validate flags the phantom committed story",
              "committed story STORY-900 not found" in out(r))
        repo.board("sprint-close", "BATCH-003")

        print("\n[validate] commitment drift warns (committed cap outside sprint)")
        repo.write_story("STORY-201", "todo")
        # Override capability to CAP-y while the sprint commits only CAP-x.
        repo.board("set", "STORY-201", "capability", "CAP-y")
        r = repo.board("sprint-plan-new", "--capabilities", "CAP-x",
                       "--goal", "g", "--stories", "STORY-201", "--id", "BATCH-004")
        check("sprint committing an off-capability story created", r.returncode == 0)
        r = repo.board("validate")
        check("validate WARNS on commitment drift",
              "outside the sprint's committed" in out(r))
        repo.board("sprint-close", "BATCH-004")

        print("\n[validate] prep firewall — a prep idea on the board is smuggling")
        # A prep idea that already has a board file = it entered the build loop.
        d = os.path.join(tmp, "backlog", "board", "todo")
        with open(os.path.join(d, "IDEA-001.md"), "w", encoding="utf-8") as f:
            f.write("---\nid: IDEA-001\ntype: idea\n---\n\nsmuggled\n")
        r = repo.board("sprint-plan-new", "--capabilities", "CAP-x", "--goal", "g",
                       "--prep", "idea:IDEA-001", "--id", "BATCH-005")
        check("sprint with a prep idea created", r.returncode == 0)
        r = repo.board("validate")
        check("validate BLOCKS a prep idea that has a board file (firewall)",
              "must stay firewalled" in out(r))
        os.remove(os.path.join(d, "IDEA-001.md"))
        repo.board("sprint-close", "BATCH-005")

        print("\n[validate] prep story must be in the committed list")
        r = repo.board("sprint-plan-new", "--capabilities", "CAP-x", "--goal", "g",
                       "--stories", "STORY-200", "--prep", "story:STORY-777",
                       "--id", "BATCH-006")
        check("sprint with an uncommitted prep story created", r.returncode == 0)
        r = repo.board("validate")
        check("validate flags a prep story not in the committed list",
              "is not in the committed stories list" in out(r))
        repo.board("sprint-close", "BATCH-006")

        # ---- STEP 2: retrospective ceremony ----
        print("\n[sprint-retro] refuses to retro an ACTIVE sprint")
        repo.board("sprint-plan-new", "--capabilities", "CAP-x", "--goal", "g",
                   "--id", "BATCH-010")
        r = repo.board("sprint-retro", "--batch", "BATCH-010")
        check("retro refused while the sprint is active",
              r.returncode != 0 and "still active" in out(r))
        repo.board("sprint-close", "BATCH-010")

        print("\n[sprint-retro] scaffolds a RETRO on a closed sprint (windowed)")
        # A closed sprint with a fixed window so seeded events are deterministic.
        bdir = os.path.join(tmp, "backlog", "batches")
        with open(os.path.join(bdir, "BATCH-020.md"), "w", encoding="utf-8") as f:
            f.write("---\nid: BATCH-020\ntype: batch\nstatus: closed\n"
                    "created: 2026-06-01\nwip_limit: 3\n"
                    "capabilities: [CAP-x]\nstories: [STORY-200, STORY-201]\n---\n"
                    "\n## Goal\nretro fixture\n")
        # STORY-200 done INSIDE the window; STORY-201 done AFTER close (outside);
        # the batch-close event bounds the window.
        repo.write_events([
            {"ts": "2026-06-10T12:00:00+00:00", "tool": "board", "event": "move",
             "outcome": "ok", "story_id": "STORY-200", "from": "review", "to": "done"},
            {"ts": "2026-06-25T12:00:00+00:00", "tool": "board", "event": "move",
             "outcome": "ok", "story_id": "STORY-201", "from": "review", "to": "done"},
            {"ts": "2026-06-20T00:00:00+00:00", "tool": "board",
             "event": "batch-close", "outcome": "ok", "batch_id": "BATCH-020"},
        ])
        r = repo.board("sprint-retro", "--batch", "BATCH-020")
        check("sprint-retro scaffolds on a closed sprint", r.returncode == 0)
        rpath = os.path.join(tmp, "backlog", "retros", "RETRO-001.md")
        rtext = open(rpath, encoding="utf-8").read() if os.path.exists(rpath) else ""
        check("RETRO-001 written", bool(rtext))
        check("retro points at its batch", "batch: BATCH-020" in rtext)
        check("committed count frozen (2)", "committed: 2" in rtext)
        check("shipped count frozen (1 — post-close done excluded by window)",
              "shipped: 1" in rtext)
        check("shipped lists STORY-200", "shipped:   STORY-200" in rtext)
        check("carried lists the out-of-window STORY-201",
              "carried:" in rtext and "STORY-201" in rtext)
        check("metrics snapshot embedded", "## Metrics snapshot" in rtext)

        print("\n[metrics --sprint] scopes aggregates to the sprint window")
        r = repo.board("metrics", "--sprint", "BATCH-020", "--json")
        check("metrics --sprint succeeds", r.returncode == 0)
        mw = json.loads(r.stdout)
        check("windowed events exclude the out-of-window move (2 of 3)",
              mw["events_total"] == 2)
        r = repo.board("metrics", "--json")
        check("unwindowed metrics sees all seeded events (3)",
              json.loads(r.stdout)["events_total"] == 3)

        print("\n[sprint-retro] proposal lifecycle: accept spawns IDEA, reject flips")
        with open(rpath, "a", encoding="utf-8") as f:
            f.write("| P-1 | board.py done-gate | tool | proposed | — |\n")
            f.write("| P-2 | Acceptance-gate checklist | gate | proposed | — |\n")
        r = repo.board("sprint-retro", "--batch", "BATCH-020", "--accept", "P-1")
        check("accept P-1 succeeds", r.returncode == 0)
        rtext = open(rpath, encoding="utf-8").read()
        check("P-1 accepted and records a spawned IDEA in result",
              "accepted | IDEA-" in rtext)
        idir = os.path.join(tmp, "backlog", "ideas")
        spawned = [f for f in os.listdir(idir)
                   if f.startswith("IDEA-") and f.endswith(".md")]
        check("accept spawned an IDEA into the inbox", len(spawned) >= 1)
        itext = open(os.path.join(idir, sorted(spawned)[-1]), encoding="utf-8").read()
        check("spawned IDEA is provenance-stamped from the retro",
              "found_by: retro" in itext and "born_from: RETRO-001" in itext)
        r = repo.board("sprint-retro", "--batch", "BATCH-020", "--reject", "P-2")
        check("reject P-2 succeeds", r.returncode == 0)
        rtext = open(rpath, encoding="utf-8").read()
        check("P-2 flipped to rejected", "gate | rejected |" in rtext)
        r = repo.board("validate")
        check("a well-formed retro adds no retro/proposal violations",
              "dangling" not in out(r) and "RETRO-001:" not in out(r)
              and "status '" not in out(r))

        print("\n[idea-new] captures a provenance-stamped, firewalled idea")
        r = repo.board("idea-new", "--title", "Out-of-scope thing",
                       "--born-from", "STORY-200", "--why", "needs a new SAD section")
        check("idea-new succeeds", r.returncode == 0)
        files = sorted(f for f in os.listdir(idir)
                       if f.startswith("IDEA-") and f.endswith(".md"))
        newest = open(os.path.join(idir, files[-1]), encoding="utf-8").read()
        check("captured idea is inbox status", "status: inbox" in newest)
        check("captured idea stamps born_from", "born_from: STORY-200" in newest)
        r = repo.board("idea-list")
        check("idea-list shows the inbox", r.returncode == 0 and "IDEA-" in r.stdout)

        print("\n[idea-archive] stale inbox ideas (A5) move to archive/, fresh stay")
        from datetime import datetime, timedelta, timezone  # noqa: E402

        def write_idea(iid, captured, status="inbox"):
            with open(os.path.join(idir, f"{iid}.md"), "w", encoding="utf-8") as f:
                f.write(f"---\nid: {iid}\ntype: idea\nstatus: {status}\n"
                        f"captured: {captured}\nborn_from: STORY-200\n---\n\n"
                        f"# {iid} — sample\n\nbody\n")

        today = datetime.now(timezone.utc).date()
        old = (today - timedelta(days=200)).isoformat()
        fresh = (today - timedelta(days=5)).isoformat()
        write_idea("IDEA-900", old)         # stale inbox idea
        write_idea("IDEA-901", fresh)       # fresh inbox idea
        write_idea("IDEA-902", old, status="promoted")  # old but promoted — keep

        r = repo.board("idea-list")
        check("idea-list flags the stale idea", "IDEA-900" in r.stdout
              and "STALE" in r.stdout)

        r = repo.board("idea-archive", "--dry-run")
        archive_dir = os.path.join(idir, "archive")
        check("dry-run names the stale idea", "IDEA-900" in r.stdout)
        check("dry-run moves nothing", not os.path.exists(archive_dir)
              and os.path.exists(os.path.join(idir, "IDEA-900.md")))

        r = repo.board("idea-archive")
        check("idea-archive succeeds", r.returncode == 0)
        check("stale idea left the inbox",
              not os.path.exists(os.path.join(idir, "IDEA-900.md")))
        archived = os.path.join(archive_dir, "IDEA-900.md")
        check("stale idea landed in archive/", os.path.exists(archived))
        atext = open(archived, encoding="utf-8").read() if os.path.exists(archived) else ""
        check("archived idea flips status + stamps date",
              "status: archived" in atext and "archived:" in atext)
        check("fresh inbox idea is untouched",
              os.path.exists(os.path.join(idir, "IDEA-901.md")))
        check("promoted idea is never archived",
              os.path.exists(os.path.join(idir, "IDEA-902.md")))

        r = repo.board("idea-list")
        check("idea-list no longer shows the archived idea", "IDEA-900" not in r.stdout)

        r = repo.board("validate")
        check("validate is clean once stale ideas are archived",
              "idea-archive" not in out(r))
        # Re-introduce a stale idea: validate should nudge (non-blocking warning).
        write_idea("IDEA-903", old)
        r = repo.board("validate")
        check("validate WARNS on a stale inbox idea",
              "IDEA-903" in out(r) and "idea-archive" in out(r))
        r = repo.board("idea-archive", "--days", "365")
        check("custom --days horizon spares a 200d idea",
              os.path.exists(os.path.join(idir, "IDEA-903.md")))
        repo.board("idea-archive")  # clean up so later checks see a tidy inbox
        for leftover in ("IDEA-901.md", "IDEA-902.md"):
            p = os.path.join(idir, leftover)
            if os.path.exists(p):
                os.remove(p)

        print("\n[validate] idea firewall — a story parented on an IDEA fails")
        repo.write_story("STORY-250", "todo", parent="IDEA-009")
        r = repo.board("validate")
        check("validate BLOCKS a story parented directly on an IDEA",
              r.returncode != 0 and "firewalled" in out(r))
        os.remove(repo.story_path("STORY-250"))

        print("\n[render] board.md + index.html surface the firewalled idea inbox (A8)")
        # one fresh inbox idea + one past the stale horizon, to exercise both the
        # count and the STALE flag on each render surface.
        write_idea("IDEA-700", fresh)   # fresh inbox idea (reuses §A5 dates/helper)
        write_idea("IDEA-701", old)     # stale inbox idea (>STALE_IDEA_DAYS)
        r = repo.board("render")
        check("render writes board.md", r.returncode == 0)
        with open(os.path.join(tmp, "board.md"), encoding="utf-8") as f:
            bmd = f.read()
        check("board.md has an Idea inbox section", "## Idea inbox" in bmd)
        check("board.md lists a fresh inbox idea", "IDEA-700" in bmd)
        check("board.md flags the stale idea", "IDEA-701" in bmd and "STALE" in bmd)
        check("board.md notes the firewall", "firewall" in bmd.lower())
        r = repo.board("render-html")
        check("render-html writes index.html", r.returncode == 0)
        with open(os.path.join(tmp, "backlog", "index.html"), encoding="utf-8") as f:
            html = f.read()
        check("index.html has an Idea inbox tab", 'data-tab="inbox"' in html)
        check("index.html embeds the inbox ideas", "IDEA-700" in html and "IDEA-701" in html)
        check("index.html marks the stale idea", '"stale":true' in html)
        for leftover in ("IDEA-700.md", "IDEA-701.md"):
            os.remove(os.path.join(idir, leftover))

        print("\n[validate] a dangling accepted proposal (no IDEA) is a problem")
        with open(rpath, "a", encoding="utf-8") as f:
            f.write("| P-3 | orphan change | tool | accepted | — |\n")
        r = repo.board("validate")
        check("validate flags an accepted proposal with empty result",
              r.returncode != 0 and "dangling" in out(r))

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    run()
    report()
