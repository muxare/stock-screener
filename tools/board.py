#!/usr/bin/env python3
"""board.py — the ONLY sanctioned way to mutate the kanban board.

The board is a folder structure: backlog/board/<column>/STORY-*.md.
A story's column IS its status — there is no `status:` frontmatter.
Moves are validated file renames, so state is deterministic, atomic, and
git-tracked (a column change shows up as a rename in the diff).

Transition policy (configured for this project):
  - forward path is linear: todo -> in-progress -> review -> done
  - NO forward skips (can't jump todo -> review)
  - back-moves ARE allowed (review -> in-progress, in-progress -> todo, ...)
  - `blocked` is a column reachable from any active column; unblocking
    returns the story to the column it came from (stamped as prev_column)
  - moving to `done` is REFUSED while any acceptance-criteria box is unchecked

Commands:
  move <id> <column> [--reason TEXT] [--force-attempts]
  list [--column C] [--capability ID] [--target T] [--json]
  new --capability ID --parent FEAT-ID [--id STORY-NNN] [--title ...]
  show <id>
  render            # write a human-readable board.md (pure read, not state)
  validate          # check invariants across the whole board
  logs [--tail N]   # show workflow audit log (.workflow/events.jsonl)
"""
import argparse, glob, json, os, re, sys, shutil

import workflow_log

COLUMNS = ["todo", "in-progress", "review", "done", "blocked"]
ACTIVE = ["todo", "in-progress", "review", "done"]  # the linear path
FORWARD = {"todo": "in-progress", "in-progress": "review", "review": "done"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(ROOT, "backlog", "board")
TEMPLATE = os.path.join(ROOT, "backlog", "stories", "STORY.template.md")
FEATURES = os.path.join(ROOT, "backlog", "features")
EPICS = os.path.join(ROOT, "backlog", "epics")
IDEAS = os.path.join(ROOT, "backlog", "ideas")
PLANS = os.path.join(ROOT, "backlog", "plans")
SAD_DIR = os.path.join(ROOT, "backlog", "sad")
ANCHOR_RE = re.compile(r"SAD#\d+(?:\.\d+)*")
CAPABILITY_RE = re.compile(r"### SAD#3(?:\.\d+)?\s+([\w.*-]+):")
IDEA_ID = re.compile(r"^IDEA-\d{3}$")
PLAN_ID = re.compile(r"^PLAN-\d{3}$")
SAD_ID = re.compile(r"^SAD-\d{3}$")
EPIC_ID = re.compile(r"^EPIC-\d{3}$")
FEAT_ID = re.compile(r"^FEAT-\d{3}$")
STORY_ID = re.compile(r"^STORY-\d{3}$")
SENTINELS = ("", "[]", "~", "None")


def _log(event, outcome="ok", message="", **fields):
    workflow_log.log_event("board", event, outcome=outcome, message=message, **fields)


def _fatal(message, event="run", **fields):
    _log(event, outcome="error", message=message, **fields)
    sys.exit(message)


# ---------- frontmatter helpers ----------
def split_fm(text):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.DOTALL)
    if not m:
        return None, text
    fm = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        v = re.sub(r"\s+#.*$", "", v).strip()  # strip comment, keep SAD#anchors
        fm[k.strip()] = v.strip()
    return fm, m.group(2)


def dump_fm(fm, body):
    lines = ["---"]
    for k, v in fm.items():
        lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines) + "\n" + body


def read_story(path):
    with open(path, encoding="utf-8") as f:
        fm, body = split_fm(f.read())
    fm = fm or {}
    fm["_path"] = path
    fm["_column"] = os.path.basename(os.path.dirname(path))
    return fm, body


def find_story(story_id):
    for col in COLUMNS:
        p = os.path.join(BOARD, col, f"{story_id}.md")
        if os.path.exists(p):
            return p
    hits = glob.glob(os.path.join(BOARD, "*", f"{story_id}.md"))
    return hits[0] if hits else None


def all_stories():
    out = []
    for col in COLUMNS:
        for p in sorted(glob.glob(os.path.join(BOARD, col, "STORY-*.md"))):
            fm, _ = read_story(p)
            out.append(fm)
    return out


def parse_sad_refs(value):
    """Parse sad_refs frontmatter: single anchor, comma-separated, or [a, b] list."""
    if value is None:
        return []
    v = str(value).strip()
    if v in SENTINELS:
        return []
    if v.startswith("[") and v.endswith("]"):
        return [p.strip() for p in v[1:-1].split(",")
                if p.strip().startswith("SAD#")]
    if "," in v:
        return [p.strip() for p in v.split(",") if p.strip().startswith("SAD#")]
    return [v] if v.startswith("SAD#") else []


def sad_refs_nonempty(fm):
    return len(parse_sad_refs(fm.get("sad_refs"))) > 0


def prev_column_valid(fm):
    v = (fm.get("prev_column") or "").strip()
    return v not in ("", "~", "None")


def unchecked_criteria(body):
    """Return count of unchecked acceptance-criteria boxes."""
    m = re.search(r"##\s*Acceptance Criteria\s*\n(.*?)(\n##|\Z)", body, re.DOTALL)
    if not m:
        return 0
    return len(re.findall(r"^\s*-\s*\[ \]", m.group(1), re.MULTILINE))


def touch_scope(body):
    """Return list of path globs from the Touch scope section."""
    m = re.search(r"##\s*Touch scope\s*\n(.*?)(\n##|\Z)", body, re.DOTALL)
    if not m:
        return []
    globs = []
    for line in m.group(1).splitlines():
        line = line.strip().lstrip("-").strip()
        if line and not line.startswith("<"):
            globs.append(normalize_path(line))
    return globs


def normalize_path(path):
    """Repo-relative path with forward slashes and no leading ./"""
    p = path.replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    return p


def path_in_scope(path, globs):
    """Return True if `path` matches any Touch scope glob."""
    import fnmatch
    path = normalize_path(path)
    for g in globs:
        g = normalize_path(g)
        if "**" in g:
            prefix = g.split("**", 1)[0].rstrip("/")
            if not prefix:
                return True
            if path == prefix or path.startswith(prefix + "/"):
                return True
            continue
        if fnmatch.fnmatch(path, g):
            return True
        if g.endswith("/*"):
            prefix = g[:-2]
            if path == prefix or path.startswith(prefix + "/"):
                return True
    return False


def list_sad_files():
    """Return sorted paths to SAD-NNN.md files (excluding templates)."""
    out = []
    for p in sorted(glob.glob(os.path.join(SAD_DIR, "SAD-*.md"))):
        if p.endswith(".template.md"):
            continue
        out.append(p)
    return out


def sad_file_path(sad_id):
    return os.path.join(SAD_DIR, f"{sad_id}.md")


def resolve_sad_id(explicit=None):
    """Pick the SAD file id: explicit arg, or the sole SAD-NNN.md if only one."""
    if explicit:
        return explicit.strip()
    files = list_sad_files()
    if len(files) == 1:
        return os.path.splitext(os.path.basename(files[0]))[0]
    return None


def load_sad_content(sad_id=None):
    sid = resolve_sad_id(sad_id)
    if not sid:
        return None
    path = sad_file_path(sid)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    return None


def epic_sad_id(epic_fm):
    """Return the SAD-NNN id bound on an epic, if set."""
    sad = (epic_fm.get("sad") or "").strip()
    return sad if SAD_ID.match(sad) else None


def story_sad_id(story_fm):
    """Resolve SAD-NNN for a story via feature → epic → sad frontmatter."""
    parent = (story_fm.get("parent") or "").strip()
    if not FEAT_ID.match(parent):
        return None
    feat_path = os.path.join(FEATURES, f"{parent}.md")
    if not os.path.exists(feat_path):
        return None
    feat_fm, _ = read_backlog_file(feat_path)
    epic_parent = (feat_fm.get("parent") or "").strip()
    if not EPIC_ID.match(epic_parent):
        return None
    epic_path = os.path.join(EPICS, f"{epic_parent}.md")
    if not os.path.exists(epic_path):
        return None
    epic_fm, _ = read_backlog_file(epic_path)
    return epic_sad_id(epic_fm)


def sad_anchors(text):
    return set(ANCHOR_RE.findall(text))


def sad_capabilities(text):
    return set(CAPABILITY_RE.findall(text))


def feature_exists(feat_id):
    return os.path.exists(os.path.join(FEATURES, f"{feat_id}.md"))


def epic_exists(epic_id):
    return os.path.exists(os.path.join(EPICS, f"{epic_id}.md"))


def read_backlog_file(path):
    with open(path, encoding="utf-8") as f:
        fm, body = split_fm(f.read())
    fm = fm or {}
    fm["_path"] = path
    default_id = os.path.splitext(os.path.basename(path))[0]
    fm.setdefault("id", default_id)
    return fm, body


def all_epics():
    out = []
    for p in sorted(glob.glob(os.path.join(EPICS, "EPIC-*.md"))):
        if p.endswith(".template.md"):
            continue
        fm, _ = read_backlog_file(p)
        out.append(fm)
    return out


def all_features():
    out = []
    for p in sorted(glob.glob(os.path.join(FEATURES, "FEAT-*.md"))):
        if p.endswith(".template.md"):
            continue
        fm, _ = read_backlog_file(p)
        out.append(fm)
    return out


def id_matches_filename(item_id, path):
    base = os.path.splitext(os.path.basename(path))[0]
    return item_id == base


def git_changed_files(base):
    """Files changed (vs `base` ref) — staged, unstaged, and untracked."""
    import subprocess
    def run(cmd):
        try:
            out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            return out.stdout.splitlines() if out.returncode == 0 else []
        except Exception:
            return []
    changed = set()
    changed.update(run(["git", "diff", "--name-only", base]))
    changed.update(run(["git", "diff", "--name-only", "--cached", base]))
    changed.update(run(["git", "ls-files", "--others", "--exclude-standard"]))
    return {normalize_path(c) for c in changed if c}


def _git_run(cmd):
    import subprocess
    try:
        out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        return out.stdout if out.returncode == 0 else ""
    except Exception:
        return ""


TEST_FILE_PAT = ("*test*", "*Test*", "*spec*", "*.Tests.*")
TEST_CASE = re.compile(r"^\s*(?:def test_|(?:async\s+)?def test_)", re.I)
TEST_CASE_JS = re.compile(r"^\s*(?:it|test)\(", re.I)
TEST_CASE_CS = re.compile(r"^\s*\[Test(?:Method|Case)?\]", re.I)
SKIP = re.compile(
    r"\b(skip|xit|xdescribe|\.only|Ignore|@pytest\.mark\.skip|todo!)\b", re.I
)
ASSERT = re.compile(r"\b(assert|expect|should|Assert\.)\b", re.I)
WEAK_ASSERT = re.compile(
    r"\bassert\s+True\b|\bassert\s+1\s*==\s*1\b|expect\s*\(\s*true\s*\)",
    re.I,
)


def is_test_file(path):
    import fnmatch
    path = normalize_path(path)
    return any(fnmatch.fnmatch(path, p) for p in TEST_FILE_PAT)


def _is_test_case_line(line):
    s = line.strip()
    return bool(
        TEST_CASE.search(s) or TEST_CASE_JS.search(s) or TEST_CASE_CS.search(s)
    )


def git_deleted_test_files(base):
    """Flag test files removed since `base`."""
    deleted = set()
    for extra in ([], ["--cached"]):
        out = _git_run(
            ["git", "diff", "--name-only", "--diff-filter=D", base, *extra]
        )
        deleted.update(normalize_path(l) for l in out.splitlines() if l.strip())
    return [f"{f}: test file deleted" for f in sorted(deleted) if is_test_file(f)]


def git_test_count_regression(base):
    """Flag net loss of test-case definitions in test files."""
    import fnmatch
    diff = _git_run(["git", "diff", base, "--unified=0"])
    per_file = {}
    cur, is_test = None, False
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            cur = normalize_path(line[6:])
            is_test = any(fnmatch.fnmatch(cur, p) for p in TEST_FILE_PAT)
            per_file.setdefault(cur, [0, 0])
            continue
        if not is_test or not cur:
            continue
        if line.startswith("-") and not line.startswith("---") and _is_test_case_line(line[1:]):
            per_file[cur][0] += 1
        if line.startswith("+") and not line.startswith("+++") and _is_test_case_line(line[1:]):
            per_file[cur][1] += 1
    flags = []
    for path, (removed, added) in sorted(per_file.items()):
        net = removed - added
        if net > 0:
            flags.append(f"{path}: {net} test case(s) removed (added {added}, removed {removed})")
    return flags


def git_test_weakening(base):
    """Heuristic: in test files, flag removed assertions, added skips, weak asserts."""
    import fnmatch
    diff = _git_run(["git", "diff", base, "--unified=0"])
    flags, cur = [], None
    is_test = False
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            cur = normalize_path(line[6:])
            is_test = any(fnmatch.fnmatch(cur, p) for p in TEST_FILE_PAT)
            continue
        if not is_test:
            continue
        body = line[1:].strip()
        if line.startswith("-") and not line.startswith("---") and ASSERT.search(body):
            flags.append(f"{cur}: removed assertion → {body[:60]}")
        if line.startswith("+") and not line.startswith("+++"):
            if SKIP.search(body):
                flags.append(f"{cur}: added skip/ignore → {body[:60]}")
            if WEAK_ASSERT.search(body):
                flags.append(f"{cur}: weakened assertion → {body[:60]}")
    return flags


def git_test_integrity_issues(base):
    """All test-integrity checks for review-check."""
    issues = []
    issues.extend(git_deleted_test_files(base))
    issues.extend(git_test_count_regression(base))
    issues.extend(git_test_weakening(base))
    return issues


# ---------- legal-move table ----------
def legal_move(src, dst):
    """Return (ok, reason)."""
    if dst not in COLUMNS:
        return False, f"unknown column '{dst}'"
    if src == dst:
        return False, "already in that column"
    if dst == "blocked":
        if src not in ACTIVE:
            return False, "can only block from an active column"
        return True, ""
    if src == "blocked":
        # unblock: must return to where it came from (handled by caller)
        return True, ""
    si, di = ACTIVE.index(src), ACTIVE.index(dst)
    if di > si + 1:
        return False, f"no forward skips ({src} -> {dst}); must pass through {ACTIVE[si+1]}"
    return True, ""  # forward-by-one or any back-move


# ---------- commands ----------
def cmd_move(args):
    path = find_story(args.id)
    if not path:
        _fatal(f"error: {args.id} not found", event="move", story_id=args.id)
    fm, body = read_story(path)
    src = fm["_column"]
    dst = args.column

    # unblock resolves to prev_column unless an explicit target was given
    if src == "blocked" and dst == "blocked":
        _fatal("error: already blocked", event="move", story_id=args.id)
    if src == "blocked" and args.column == "unblock":
        dst = fm.get("prev_column", "todo")

    ok, reason = legal_move(src, dst)
    if not ok:
        _log("move", outcome="refused", message=reason, story_id=args.id, **{"from": src, "to": dst})
        sys.exit(f"refused: {reason}")

    # invariant gates
    if dst == "in-progress" and not sad_refs_nonempty(fm):
        msg = f"{args.id} has empty sad_refs; cannot start untraceable work"
        _log("move", outcome="refused", message=msg, story_id=args.id, **{"from": src, "to": dst})
        sys.exit(f"refused: {msg}")
    if dst == "done":
        n = unchecked_criteria(body)
        if n:
            msg = f"{args.id} has {n} unchecked acceptance criteria"
            _log("move", outcome="refused", message=msg, story_id=args.id, **{"from": src, "to": dst})
            sys.exit(f"refused: {msg}")

    # frontmatter stamping
    fm.pop("_path", None); fm.pop("_column", None)
    if dst == "blocked":
        fm["prev_column"] = src
        fm["blocked_reason"] = args.reason or fm.get("blocked_reason", "unspecified")
    if src == "blocked":
        fm.pop("prev_column", None)
        fm["blocked_reason"] = "~"
    if dst == "in-progress":
        try:
            fm["attempts"] = str(int(fm.get("attempts", "0") or "0") + 1)
        except ValueError:
            fm["attempts"] = "1"

    dst_dir = os.path.join(BOARD, dst)
    os.makedirs(dst_dir, exist_ok=True)
    new_path = os.path.join(dst_dir, f"{args.id}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    shutil.move(path, new_path)
    print(f"moved {args.id}: {src} -> {dst}")
    _log(
        "move",
        story_id=args.id,
        **{"from": src, "to": dst, "reason": args.reason or "", "capability": fm.get("capability", "")},
    )


def cmd_list(args):
    rows = []
    for fm in all_stories():
        if args.column and fm["_column"] != args.column:
            continue
        if args.capability and fm.get("capability") != args.capability:
            continue
        if args.target and fm.get("target") != args.target:
            continue
        rows.append(fm)
    if args.json:
        slim = [{k: v for k, v in r.items() if not k.startswith("_")}
                | {"column": r["_column"], "id": r.get("id")} for r in rows]
        print(json.dumps(slim, indent=2))
        return
    for r in rows:
        print(f"{r['_column']:>12}  {r.get('id','?'):<10} cap={r.get('capability','?'):<20} sad={r.get('sad_refs','[]')}")


def cmd_new(args):
    with open(TEMPLATE, encoding="utf-8") as f:
        tpl = f.read()
    # next id
    existing = [int(re.search(r"STORY-(\d+)", f).group(1))
                for f in glob.glob(os.path.join(BOARD, "*", "STORY-*.md"))]
    nid = args.id or f"STORY-{(max(existing)+1 if existing else 1):03d}"
    fm, body = split_fm(tpl)
    fm["id"] = nid
    fm["capability"] = args.capability
    fm["parent"] = args.parent
    fm.pop("status", None)  # status is the folder, not frontmatter
    if args.title:
        body = re.sub(r"(##\s*User Story\s*\n).*", rf"\g<1>{args.title}", body, count=1)
    todo = os.path.join(BOARD, "todo")
    os.makedirs(todo, exist_ok=True)
    out = os.path.join(todo, f"{nid}.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    print(f"created {nid} in todo/  (remember to fill sad_refs before starting)")
    _log("new", story_id=nid, capability=args.capability, parent=args.parent, title=args.title or "")


def cmd_show(args):
    path = find_story(args.id)
    if not path:
        sys.exit(f"error: {args.id} not found")
    with open(path, encoding="utf-8") as f:
        print(f.read())


def cmd_render(args):
    out = ["# Kanban Board", "_generated view — the folder structure is the source of truth_\n"]
    for col in COLUMNS:
        items = [fm for fm in all_stories() if fm["_column"] == col]
        out.append(f"\n## {col.replace('-',' ').title()} ({len(items)})\n")
        for fm in items:
            line = f"- **{fm.get('id','?')}** · cap `{fm.get('capability','?')}` · sad `{fm.get('sad_refs','[]')}`"
            if col == "blocked":
                line += f" · ⚠ {fm.get('blocked_reason','?')} (from {fm.get('prev_column','?')})"
            out.append(line)
    p = os.path.join(ROOT, "board.md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"wrote {p}")


def cmd_validate(args):
    problems = []
    stories = all_stories()
    ids_seen = {}
    story_caps = set()
    sad_files = list_sad_files()
    sad_id = getattr(args, "sad", None)
    if len(sad_files) > 1 and not sad_id:
        problems.append(
            "multiple SAD files in backlog/sad/; pass --sad SAD-NNN to validate"
        )
    elif sad_id and not os.path.exists(sad_file_path(sad_id)):
        problems.append(f"{sad_id}: SAD file not found in backlog/sad/")

    epic_ids = {}
    for fm in all_epics():
        eid = fm.get("id", "?")
        if not EPIC_ID.match(eid):
            problems.append(f"{eid}: invalid epic id format (use EPIC-NNN)")
        if eid in epic_ids:
            problems.append(f"{eid}: duplicate epic id")
        epic_ids[eid] = fm["_path"]
        if not id_matches_filename(eid, fm["_path"]):
            problems.append(f"{eid}: frontmatter id does not match filename")
        bound = epic_sad_id(fm)
        if bound and not os.path.exists(sad_file_path(bound)):
            problems.append(f"{eid}: epic sad {bound} not found in backlog/sad/")

    feat_ids = {}
    for fm in all_features():
        fid = fm.get("id", "?")
        if not FEAT_ID.match(fid):
            problems.append(f"{fid}: invalid feature id format (use FEAT-NNN)")
        if fid in feat_ids:
            problems.append(f"{fid}: duplicate feature id")
        feat_ids[fid] = fm["_path"]
        if not id_matches_filename(fid, fm["_path"]):
            problems.append(f"{fid}: frontmatter id does not match filename")
        parent = (fm.get("parent") or "").strip()
        if parent and parent not in SENTINELS and parent != "EPIC-000":
            if EPIC_ID.match(parent) and not epic_exists(parent):
                problems.append(f"{fid}: orphan feature — parent {parent} not found")

    for fm in stories:
        sid = fm.get("id", "?")
        col = fm["_column"]
        if not STORY_ID.match(sid):
            problems.append(f"{sid}: invalid story id format (use STORY-NNN)")
        if sid in ids_seen:
            problems.append(f"{sid}: duplicate id (also in {ids_seen[sid]})")
        ids_seen[sid] = col

        if col in ("in-progress", "review", "done") and not sad_refs_nonempty(fm):
            problems.append(f"{sid}: active but empty sad_refs")
        cap = (fm.get("capability") or "").strip()
        if not cap or cap == "<capability-id>":
            problems.append(f"{sid}: missing capability")
        elif cap not in SENTINELS:
            story_caps.add(cap)

        parent = (fm.get("parent") or "").strip()
        if parent and parent not in SENTINELS and parent != "FEAT-000":
            if FEAT_ID.match(parent) and not feature_exists(parent):
                problems.append(f"{sid}: orphan story — parent {parent} not found")

        if col == "blocked" and not prev_column_valid(fm):
            problems.append(f"{sid}: blocked without prev_column (can't unblock cleanly)")

    sad_text = load_sad_content(sad_id)
    if sad_text:
        anchors = sad_anchors(sad_text)
        caps = sad_capabilities(sad_text)
        for fm in stories:
            sid = fm.get("id", "?")
            for ref in parse_sad_refs(fm.get("sad_refs")):
                if ref not in anchors:
                    problems.append(f"{sid}: dangling sad_ref {ref}")
            cap = (fm.get("capability") or "").strip()
            if cap and cap not in SENTINELS and caps and cap not in caps:
                problems.append(f"{sid}: unknown capability {cap}")
        if stories and caps:
            for cap in sorted(caps):
                if cap not in story_caps:
                    problems.append(f"capability {cap}: no story coverage")

    if problems:
        print("INVARIANT VIOLATIONS:")
        for p in problems:
            print("  - " + p)
        _log("validate", outcome="refused", message=f"{len(problems)} violations", count=len(problems))
        sys.exit(1)
    print("ok: no invariant violations")
    _log("validate", message="no violations")


def cmd_review_check(args):
    """Did the loop cheat? Check scope adherence + test integrity before done."""
    path = find_story(args.id)
    if not path:
        _fatal(f"error: {args.id} not found", event="review-check", story_id=args.id)
    fm, body = read_story(path)
    base = args.base
    problems, warnings = [], []

    # 1. acceptance criteria actually ticked
    n = unchecked_criteria(body)
    if n:
        problems.append(f"{n} acceptance criteria still unchecked")

    # 2. nothing changed outside Touch scope
    scope = touch_scope(body)
    if not scope:
        warnings.append("no Touch scope declared — cannot verify scope adherence")
    else:
        changed = git_changed_files(base)

        def ignorable(f):
            f = normalize_path(f)
            # backlog data, docs, and the board tool's own audit log are
            # tooling-managed — not part of any story's code change.
            return (
                f.startswith("backlog/")
                or f.startswith(".workflow/")
                or f.endswith(".md")
            )

        out_of_scope = [f for f in changed
                        if not ignorable(f) and not path_in_scope(f, scope)]
        for f in out_of_scope:
            problems.append(f"changed outside Touch scope: {f}")

    # 3. test integrity (deletions, count regression, weakening)
    for flag in git_test_integrity_issues(base):
        problems.append(f"test integrity: {flag}")

    label = args.id
    if problems:
        print(f"REVIEW-CHECK FAILED for {label}:")
        for p in problems:
            print("  ✗ " + p)
        for w in warnings:
            print("  ! " + w)
        print(f"\nNot eligible for `done`. Fix, or `board.py move {label} blocked --reason \"review-check\"`.")
        _log(
            "review-check",
            outcome="refused",
            story_id=label,
            base=base,
            message=f"{len(problems)} problems",
            count=len(problems),
        )
        sys.exit(1)
    for w in warnings:
        print("  ! " + w)
    print(f"review-check passed for {label}: in scope, test integrity ok, criteria met")
    _log("review-check", story_id=label, base=base, warnings=len(warnings))


def cmd_logs(args):
    rows = workflow_log.read_events(
        tail=args.tail,
        tool=args.tool,
        event=args.event,
        story_id=args.story,
        outcome=args.outcome,
    )
    workflow_log.print_events(rows, as_json=args.json)


def main():
    ap = argparse.ArgumentParser(prog="board.py")
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("move"); m.add_argument("id"); m.add_argument("column")
    m.add_argument("--reason"); m.add_argument("--force-attempts", action="store_true")
    m.set_defaults(fn=cmd_move)

    l = sub.add_parser("list"); l.add_argument("--column"); l.add_argument("--capability")
    l.add_argument("--target"); l.add_argument("--json", action="store_true")
    l.set_defaults(fn=cmd_list)

    n = sub.add_parser("new"); n.add_argument("--capability", required=True)
    n.add_argument("--parent", required=True); n.add_argument("--id"); n.add_argument("--title")
    n.set_defaults(fn=cmd_new)

    s = sub.add_parser("show"); s.add_argument("id"); s.set_defaults(fn=cmd_show)
    sub.add_parser("render").set_defaults(fn=cmd_render)
    v = sub.add_parser("validate")
    v.add_argument("--sad", help="SAD-NNN id when multiple contracts exist")
    v.set_defaults(fn=cmd_validate, sad=None)

    lg = sub.add_parser("logs")
    lg.add_argument("--tail", type=int, default=50)
    lg.add_argument("--tool")
    lg.add_argument("--event")
    lg.add_argument("--story")
    lg.add_argument("--outcome")
    lg.add_argument("--json", action="store_true")
    lg.set_defaults(fn=cmd_logs)

    rc = sub.add_parser("review-check"); rc.add_argument("id")
    rc.add_argument("--base", default="HEAD",
                    help="git ref to diff against (default HEAD; use the pre-story commit)")
    rc.set_defaults(fn=cmd_review_check)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
