#!/usr/bin/env python3
"""Black-box tests for the backlog-refinement layer in board.py (IDEA-016):
  - combine: fold source stories into a target (union sad_refs + Touch scope +
    acceptance criteria), stamp combined_from/combined_into, retire the sources;
    active sources are refused
  - retire: move to the terminal `retired` column; terminal (revive only to todo)
  - fanout: mark a FEAT as a verified-disjoint lane set; refuse overlaps / <2
    children / a spine that is also a child; validate flags overlaps and a stale
    proof

Reuses the throwaway-repo harness from test_board_gates. Run directly:

    python3 tools/tests/test_board_refine.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_board_gates import (  # noqa: E402  (reuse the harness)
    setup_repo, check, report,
)
import re  # noqa: E402
import tempfile  # noqa: E402
import shutil  # noqa: E402


def out(r):
    return r.stdout + r.stderr


def write_feature(repo, fid, parent="EPIC-000", extra=""):
    d = os.path.join(repo.root, "backlog", "features")
    os.makedirs(d, exist_ok=True)
    text = (f"---\nid: {fid}\ntype: feature\nparent: {parent}\n"
            f"capabilities: [CAP-x]\n{extra}---\n\n# {fid} — test feature\n\nbody\n")
    with open(os.path.join(d, f"{fid}.md"), "w", encoding="utf-8") as f:
        f.write(text)


def feat_text(repo, fid):
    with open(os.path.join(repo.root, "backlog", "features", f"{fid}.md"),
              encoding="utf-8") as f:
        return f.read()


def run():
    tmp = tempfile.mkdtemp(prefix="board-refine-test-")
    try:
        repo = setup_repo(tmp)
        repo.write_sad(caps=("CAP-x",), status="Approved")

        # ---------------------------------------------------------------- combine
        print("\n[combine] folds a source into a target and retires the source")
        repo.write_story("STORY-300", "todo", sad_refs="[SAD#1.1]",
                         scope="src/target/**", criteria=("target crit one",),
                         parent="FEAT-000")
        repo.write_story("STORY-301", "todo", sad_refs="[SAD#1.2]",
                         scope="src/source/**", criteria=("source crit two",),
                         parent="FEAT-000")
        r = repo.board("combine", "STORY-301", "--into", "STORY-300")
        check("combine succeeds", r.returncode == 0)
        check("source retired", repo.column_of("STORY-301") == "retired")
        check("source stamped combined_into",
              repo.fm("STORY-301", "combined_into") == "STORY-300")
        check("target stamped combined_from",
              "STORY-301" in (repo.fm("STORY-300", "combined_from") or ""))
        tbody = repo.body("STORY-300")
        check("target gains the source Touch scope", "src/source/**" in tbody)
        check("target gains the source criteria (nothing lost)",
              "(from STORY-301)" in tbody and "source crit two" in tbody)
        check("target sad_refs union carries both",
              "SAD#1.1" in tbody and "SAD#1.2" in tbody)

        print("\n[combine] refuses an active (non-todo/blocked) source")
        repo.write_story("STORY-302", "review", parent="FEAT-000")
        r = repo.board("combine", "STORY-302", "--into", "STORY-300")
        check("active source refused",
              r.returncode != 0 and "only todo/blocked" in out(r))

        # ----------------------------------------------------------------- retire
        print("\n[retire] moves to the terminal column and is revivable to todo")
        repo.write_story("STORY-303", "todo", parent="FEAT-000")
        r = repo.board("retire", "STORY-303", "--reason", "superseded by STORY-300")
        check("retire succeeds", r.returncode == 0)
        check("story is retired", repo.column_of("STORY-303") == "retired")
        check("retired_reason stamped",
              "superseded" in (repo.fm("STORY-303", "retired_reason") or ""))
        r = repo.board("move", "STORY-303", "review")
        check("retired story cannot skip to review (terminal)", r.returncode != 0)
        r = repo.board("move", "STORY-303", "todo")
        check("retired story revives to todo",
              r.returncode == 0 and repo.column_of("STORY-303") == "todo")
        check("revive clears retired_reason",
              (repo.fm("STORY-303", "retired_reason") or "~") == "~")

        # ----------------------------------------------------------------- fanout
        print("\n[fanout] marks a FEAT as a verified-disjoint lane set")
        write_feature(repo, "FEAT-010")
        repo.write_story("STORY-310", "todo", scope="src/a/**", parent="FEAT-010")
        repo.write_story("STORY-311", "todo", scope="src/b/**", parent="FEAT-010")
        repo.write_story("STORY-312", "todo", scope="src/spine/**", parent="FEAT-010")
        r = repo.board("fanout", "FEAT-010", "--children", "STORY-310,STORY-311",
                       "--spine", "STORY-312")
        check("fanout succeeds on disjoint children", r.returncode == 0)
        ft = feat_text(repo, "FEAT-010")
        check("FEAT marked fanout: true", re.search(r"^fanout:\s*true$", ft, re.M) is not None)
        check("fanout_children stamped", "STORY-310" in ft and "STORY-311" in ft)
        check("fanout_verified stamped", "fanout_verified:" in ft)
        check("fanout_scope_hash stamped", "fanout_scope_hash:" in ft)
        check("fanout_spine stamped", re.search(r"^fanout_spine:\s*STORY-312$", ft, re.M) is not None)

        print("\n[fanout] validate accepts a real disjoint lane set")
        r = repo.board("validate")
        check("validate has no fanout problem for a disjoint set",
              "not a disjoint lane set" not in out(r))

        print("\n[fanout] refuses overlapping children")
        repo.write_story("STORY-313", "todo", scope="src/a/**", parent="FEAT-010")
        r = repo.board("fanout", "FEAT-010", "--children", "STORY-310,STORY-313")
        check("overlapping children refused",
              r.returncode != 0 and "disjoint lane set" in out(r))

        print("\n[fanout] refuses <2 children and a spine that is also a child")
        r = repo.board("fanout", "FEAT-010", "--children", "STORY-310")
        check("single child refused", r.returncode != 0)
        r = repo.board("fanout", "FEAT-010", "--children", "STORY-310,STORY-311",
                       "--spine", "STORY-310")
        check("spine-as-child refused",
              r.returncode != 0 and "cannot also be a child" in out(r))

        print("\n[fanout] validate flags a stale proof after a child scope edit")
        # re-stamp a clean proof, then mutate a child's Touch scope
        repo.board("fanout", "FEAT-010", "--children", "STORY-310,STORY-311")
        p = repo.story_path("STORY-311")
        txt = open(p, encoding="utf-8").read().replace("src/b/**", "src/moved/**")
        open(p, "w", encoding="utf-8").write(txt)
        r = repo.board("validate")
        check("validate warns the fanout proof is stale", "stale" in out(r))

        print("\n[fanout] --clear removes the marking")
        r = repo.board("fanout", "FEAT-010", "--clear")
        ft = feat_text(repo, "FEAT-010")
        check("fanout marking cleared",
              r.returncode == 0 and re.search(r"^fanout:\s*true$", ft, re.M) is None)

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    run()
    report()
