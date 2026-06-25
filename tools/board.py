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
  move <id> <column> [--reason TEXT] [--base REF] [--skip-review-check]
      moving to `review`/`done` runs the review-check gate against the story's
      stamped base_commit and is REFUSED on problems unless --skip-review-check
  list [--column C] [--capability ID] [--target T] [--json]
  new --capability ID --parent FEAT-ID [--id STORY-NNN] [--title ...]
  check <id> [--criterion SUBSTR | --all] [--uncheck]  # tick acceptance criteria
  set <id> <field> <value>      # set an allowlisted frontmatter field (e.g. sad_refs)
  reject <id> --reason TEXT     # Gate-4 reject: review -> in-progress, re-enters loop
  batch-new --capabilities CAP-a,CAP-b [--goal ...] [--wip N] [--id BATCH-NNN]
      Gate 3: record the committed batch (capabilities + WIP limit); one active
      batch at a time. The active batch's wip_limit caps in-progress.
  batch-close <id>              # close a batch once its commitment is complete
  batch-list [--json]           # batches + live WIP usage
  exceptions [--json]           # Gate 2/5 queue: blocked work split decision vs process
  show <id>
  render            # write a human-readable board.md (pure read, not state)
  validate          # check invariants across the whole board (incl. WIP + batch)
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
BATCHES = os.path.join(ROOT, "backlog", "batches")
BATCH_TEMPLATE = os.path.join(BATCHES, "BATCH.template.md")
ANCHOR_RE = re.compile(r"SAD#\d+(?:\.\d+)*")
CAPABILITY_RE = re.compile(r"### SAD#3(?:\.\d+)?\s+([\w.*-]+):")
IDEA_ID = re.compile(r"^IDEA-\d{3}$")
PLAN_ID = re.compile(r"^PLAN-\d{3}$")
SAD_ID = re.compile(r"^SAD-\d{3}$")
EPIC_ID = re.compile(r"^EPIC-\d{3}$")
FEAT_ID = re.compile(r"^FEAT-\d{3}$")
STORY_ID = re.compile(r"^STORY-\d{3}$")
BATCH_ID = re.compile(r"^BATCH-\d{3}$")
SENTINELS = ("", "[]", "~", "None")

# Gate 3: how many stories may sit in-progress at once when no active batch
# overrides it. The cap turns "fan debt out into the backlog" (F3) into a visible
# signal — at the limit you must finish or explicitly defer, not silently widen WIP.
DEFAULT_WIP_LIMIT = 3
# Exception queue (#8): a blocked_reason mentioning any of these reads as a
# decision only a human can make (architecture / vendor / legal) → Gate 2/5,
# versus an ordinary process block an agent can clear itself.
DECISION_SIGNAL = re.compile(
    r"\b(ADR|SAD#|vendor|legal|licen[sc]e|licensing|architecture|sign-?off)\b",
    re.I,
)


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


def parse_list(value):
    """Parse a frontmatter list field: bare, comma-separated, or [a, b]."""
    if value is None:
        return []
    v = str(value).strip()
    if v in SENTINELS:
        return []
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    return [p.strip() for p in v.split(",") if p.strip() and p.strip() not in SENTINELS]


# ---------- batch (Gate 3) + WIP helpers ----------
def all_batches():
    """Return (fm, body) for every BATCH-NNN.md, newest id last."""
    out = []
    for p in sorted(glob.glob(os.path.join(BATCHES, "BATCH-*.md"))):
        if p.endswith(".template.md"):
            continue
        out.append(read_backlog_file(p))
    return out


def active_batches():
    return [(fm, body) for fm, body in all_batches()
            if (fm.get("status") or "").strip() == "active"]


def active_batch():
    """The single active batch (fm, body), or (None, None) if zero/ambiguous."""
    actives = active_batches()
    return actives[0] if len(actives) == 1 else (None, None)


def batch_capabilities(fm):
    return parse_list(fm.get("capabilities"))


def batch_wip_limit():
    """WIP cap for in-progress: the active batch's override, else the default."""
    fm, _ = active_batch()
    if fm:
        raw = (fm.get("wip_limit") or "").strip()
        if raw and raw not in SENTINELS:
            try:
                return int(raw)
            except ValueError:
                pass
    return DEFAULT_WIP_LIMIT


def column_count(column):
    return sum(1 for fm in all_stories() if fm["_column"] == column)


def prev_column_valid(fm):
    v = (fm.get("prev_column") or "").strip()
    return v not in ("", "~", "None")


def base_commit_of(fm):
    """Return the stamped pre-story base commit, or '' if unset/sentinel."""
    v = (fm.get("base_commit") or "").strip()
    return "" if v in SENTINELS else v


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

    # WIP signal (#6): starting work past the limit is allowed but SURFACED, not
    # silent — the loop keeps moving while making overload visible at Gate 3. src
    # is never in-progress here (same-column moves are refused above), so the new
    # post-move count is current + 1.
    if dst == "in-progress":
        limit = batch_wip_limit()
        post = column_count("in-progress") + 1
        if post > limit:
            warn = (f"WIP at {post} in-progress (limit {limit}). Finish or defer "
                    f"one, or raise the batch wip_limit at Gate 3.")
            print(f"⚠ {warn}")
            _log("move", outcome="warn", message=warn, story_id=args.id,
                 count=post, **{"from": src, "to": dst})

    # hard review-check gate: a story cannot reach `review` or `done` unless the
    # anti-cheat gate ran against the pre-story base and passed. This is what
    # makes the loop trustworthy enough to leave unattended (Phase 1, #1).
    if dst in ("review", "done"):
        base = (args.base or "").strip() or base_commit_of(fm)
        if not base:
            msg = (f"{args.id} has no base_commit (legacy/in-flight story). "
                   f"Re-run `move {args.id} in-progress` to stamp it, or pass "
                   f"--base <pre-story commit>, or override with --skip-review-check")
            _log("move", outcome="refused", message=msg, story_id=args.id, **{"from": src, "to": dst})
            sys.exit(f"refused: {msg}")
        problems, warnings = run_review_check(fm, body, base)
        if problems and not args.skip_review_check:
            print(f"REVIEW-CHECK FAILED for {args.id} (base {base}):")
            for p in problems:
                print("  ✗ " + p)
            for w in warnings:
                print("  ! " + w)
            msg = f"review-check: {len(problems)} problem(s)"
            _log("move", outcome="refused", message=msg, story_id=args.id, base=base,
                 count=len(problems), **{"from": src, "to": dst})
            sys.exit(f"refused: {msg}; not eligible for {dst}. Fix, or re-run with --skip-review-check to override.")
        if problems and args.skip_review_check:
            _log("move", outcome="override", story_id=args.id, base=base,
                 message=f"--skip-review-check over {len(problems)} problem(s)",
                 count=len(problems), **{"from": src, "to": dst})

    # frontmatter stamping
    fm.pop("_path", None); fm.pop("_column", None)
    if dst == "in-progress" and not base_commit_of(fm):
        # Stamp the pre-story base ONCE (first entry), so review-check on a later
        # bounce still diffs against the original pre-story HEAD, not partial work.
        head = _git_run(["git", "rev-parse", "HEAD"]).strip()
        if head:
            fm["base_commit"] = head
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
    if dst == "review":
        # the rework brief is consumed once the story is re-submitted for review
        fm.pop("reject_reason", None)

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


def cmd_reject(args):
    """Gate-4 reject: bounce a reviewed story back into the loop (Phase 2, #11).

    The single sanctioned "no" at the acceptance gate. Returns the story to
    `in-progress` (so `/build-toward` re-picks it without a manual move) and
    stamps the rework brief as `reject_reason`, which the loop reads on re-entry.
    """
    path = find_story(args.id)
    if not path:
        _fatal(f"error: {args.id} not found", event="reject", story_id=args.id)
    fm, body = read_story(path)
    src = fm["_column"]
    if src != "review":
        msg = f"{args.id} is in {src}, not review; reject applies at the review gate"
        _log("reject", outcome="refused", message=msg, story_id=args.id)
        sys.exit(f"refused: {msg}")

    fm.pop("_path", None); fm.pop("_column", None)
    fm["reject_reason"] = args.reason
    try:
        fm["attempts"] = str(int(fm.get("attempts", "0") or "0") + 1)
    except ValueError:
        fm["attempts"] = "1"

    dst_dir = os.path.join(BOARD, "in-progress")
    os.makedirs(dst_dir, exist_ok=True)
    new_path = os.path.join(dst_dir, f"{args.id}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    shutil.move(path, new_path)
    print(f"rejected {args.id}: review -> in-progress (re-enters the build loop)")
    _log("reject", story_id=args.id, message=args.reason,
         **{"from": "review", "to": "in-progress"})


def cmd_batch_new(args):
    """Gate 3: record a batch — the capabilities you commit /build-toward to.

    A batch is the prioritisation checkpoint, not a timebox: a named, dated set
    of capabilities plus the WIP limit for this run. Only one batch is active at
    a time, so this is the single standing answer to "what are we building now".
    """
    caps = [c.strip() for c in (args.capabilities or "").split(",") if c.strip()]
    if not caps:
        _fatal("batch-new needs --capabilities CAP-a,CAP-b", event="batch-new")
    if active_batches():
        ids = ", ".join(fm.get("id", "?") for fm, _ in active_batches())
        _fatal(f"an active batch already exists ({ids}); close it first "
               f"(board.py batch-close <id>) — Gate 3 is one commitment at a time",
               event="batch-new")
    existing = [int(re.search(r"BATCH-(\d+)", os.path.basename(p)).group(1))
                for p in glob.glob(os.path.join(BATCHES, "BATCH-*.md"))
                if not p.endswith(".template.md")]
    bid = args.id or f"BATCH-{(max(existing) + 1 if existing else 1):03d}"
    if not BATCH_ID.match(bid):
        _fatal(f"{bid}: invalid batch id (use BATCH-NNN)", event="batch-new")
    from datetime import datetime, timezone
    created = datetime.now(timezone.utc).date().isoformat()
    wip = str(args.wip if args.wip is not None else DEFAULT_WIP_LIMIT)
    fm = {
        "id": bid,
        "type": "batch",
        "status": "active",
        "created": created,
        "wip_limit": wip,
        "capabilities": "[" + ", ".join(caps) + "]",
    }
    cap_lines = "\n".join(f"- {c}" for c in caps)
    body = (f"\n## Goal\n{args.goal or '<batch goal — the Gate-3 commitment>'}\n\n"
            f"## Capabilities committed\n{cap_lines}\n\n## Notes\n")
    os.makedirs(BATCHES, exist_ok=True)
    out = os.path.join(BATCHES, f"{bid}.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    print(f"created {bid} (active): caps={caps} wip_limit={wip}")
    _log("batch-new", message=f"caps={','.join(caps)} wip={wip}",
         batch_id=bid, count=len(caps))


def cmd_batch_close(args):
    """Close a batch — the Gate-3 commitment is complete, freeing the next one."""
    path = os.path.join(BATCHES, f"{args.id}.md")
    if not os.path.exists(path):
        _fatal(f"error: {args.id} not found in backlog/batches/", event="batch-close",
               batch_id=args.id)
    fm, body = read_backlog_file(path)
    if (fm.get("status") or "").strip() == "closed":
        sys.exit(f"{args.id} is already closed")
    fm.pop("_path", None)
    fm["status"] = "closed"
    with open(path, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    print(f"closed {args.id}")
    _log("batch-close", batch_id=args.id)


def cmd_batch_list(args):
    """Show batches (active first) with capabilities and live WIP usage."""
    batches = all_batches()
    if args.json:
        slim = [{k: v for k, v in fm.items() if not k.startswith("_")}
                for fm, _ in batches]
        print(json.dumps(slim, indent=2))
        return
    if not batches:
        print("(no batches — board.py batch-new --capabilities … to open Gate 3)")
        return
    ip = column_count("in-progress")
    for fm, _ in batches:
        status = (fm.get("status") or "?").strip()
        mark = "▶" if status == "active" else " "
        line = (f"{mark} {fm.get('id', '?'):<10} [{status}] "
                f"caps={fm.get('capabilities', '[]')} wip_limit={fm.get('wip_limit', '?')}")
        if status == "active":
            line += f"  (in-progress now: {ip})"
        print(line)


def cmd_exceptions(args):
    """Gate 2/5 queue (#8): everything stuck waiting on a human, in one place.

    Blocked stories are split into the ones an agent cannot clear — architecture,
    vendor, or legal decisions (Gate 2/5) — and ordinary process blocks. This is
    the surface the Scrum-Master lens and `/loop` read to ping you, instead of you
    watching the stream.
    """
    blocked = [fm for fm in all_stories() if fm["_column"] == "blocked"]
    rows = []
    for fm in sorted(blocked, key=lambda f: f.get("id", "")):
        reason = (fm.get("blocked_reason") or "").strip()
        kind = "decision" if DECISION_SIGNAL.search(reason) else "process"
        rows.append({
            "id": fm.get("id", "?"),
            "kind": kind,
            "gate": "Gate 2/5" if kind == "decision" else "agent/SM",
            "reason": reason or "unspecified",
            "from": fm.get("prev_column", "?"),
            "attempts": fm.get("attempts", "0"),
        })
    if args.json:
        print(json.dumps(rows, indent=2))
        return
    if not rows:
        print("exception queue: empty (nothing blocked)")
        _log("exceptions", count=0)
        return
    decisions = [r for r in rows if r["kind"] == "decision"]
    process = [r for r in rows if r["kind"] == "process"]
    print(f"EXCEPTION QUEUE — {len(rows)} blocked "
          f"({len(decisions)} need a human decision, {len(process)} process)\n")
    if decisions:
        print("  ▼ NEEDS A HUMAN DECISION (Gate 2/5):")
        for r in decisions:
            print(f"    {r['id']:<10} (from {r['from']}, attempts {r['attempts']})\n"
                  f"        {r['reason']}")
    if process:
        print("  ▼ process blocks (agent/SM may clear):")
        for r in process:
            print(f"    {r['id']:<10} (from {r['from']}, attempts {r['attempts']})\n"
                  f"        {r['reason']}")
    _log("exceptions", count=len(rows), message=f"{len(decisions)} decisions")


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


CRITERION_BOX = re.compile(r"^(\s*-\s*)\[( |x|X)\](\s.*)$")
SETTABLE_FIELDS = {"sad_refs", "capability", "target", "estimate", "parent"}


def cmd_check(args):
    """Tick/untick acceptance-criteria boxes — the sanctioned (logged) path.

    Direct Edit of checkboxes on an active story is blocked by the guard hook so
    the `done` gate can't be self-certified by an unaudited edit (Phase 1, #4).
    """
    if not args.all and not args.criterion:
        _fatal("specify --criterion <substr> or --all", event="check", story_id=args.id)
    path = find_story(args.id)
    if not path:
        _fatal(f"error: {args.id} not found", event="check", story_id=args.id)
    fm, body = read_story(path)
    m = re.search(r"(##\s*Acceptance Criteria\s*\n)(.*?)(\n##|\Z)", body, re.DOTALL)
    if not m:
        _fatal(f"{args.id} has no Acceptance Criteria section", event="check", story_id=args.id)
    want = not args.uncheck
    lines = m.group(2).split("\n")
    matched, changed = 0, 0
    for i, line in enumerate(lines):
        bm = CRITERION_BOX.match(line)
        if not bm:
            continue
        text = bm.group(3)
        if args.all or (args.criterion and args.criterion.lower() in text.lower()):
            matched += 1
            is_checked = bm.group(2).lower() == "x"
            if is_checked != want:
                lines[i] = f"{bm.group(1)}[{'x' if want else ' '}]{text}"
                changed += 1
    if args.criterion and matched == 0:
        _fatal(f"no acceptance criterion matches '{args.criterion}'",
               event="check", story_id=args.id)
    new_body = body[:m.start()] + m.group(1) + "\n".join(lines) + m.group(3) + body[m.end():]
    fm.pop("_path", None); fm.pop("_column", None)
    with open(path, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, new_body))
    verb = "unchecked" if args.uncheck else "checked"
    print(f"{verb} {changed}/{matched} criteria in {args.id}")
    _log("check", story_id=args.id, message=f"{verb} {changed}/{matched}",
         count=changed, **{"uncheck": args.uncheck})


def cmd_set(args):
    """Set an allowlisted frontmatter field — the sanctioned (logged) path.

    Routes gate-critical frontmatter (notably sad_refs) through an audited
    command; direct Edit of these on an active story is blocked by the guard
    hook. base_commit / attempts / column are deliberately NOT settable here.
    """
    if args.field not in SETTABLE_FIELDS:
        _fatal(f"field '{args.field}' not settable via board.py set "
               f"(allowed: {', '.join(sorted(SETTABLE_FIELDS))})",
               event="set", story_id=args.id)
    path = find_story(args.id)
    if not path:
        _fatal(f"error: {args.id} not found", event="set", story_id=args.id)
    fm, body = read_story(path)
    old = fm.get(args.field, "")
    fm.pop("_path", None); fm.pop("_column", None)
    fm[args.field] = args.value
    with open(path, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    print(f"set {args.field}: {old!r} -> {args.value!r} on {args.id}")
    _log("set", story_id=args.id, field=args.field, message=f"{old} -> {args.value}")


def cmd_show(args):
    path = find_story(args.id)
    if not path:
        sys.exit(f"error: {args.id} not found")
    with open(path, encoding="utf-8") as f:
        print(f.read())


def cmd_render(args):
    out = ["# Kanban Board", "_generated view — the folder structure is the source of truth_\n"]

    # Gate 3 header: the active batch commitment + live WIP usage (#6, #7).
    fm_b, _ = active_batch()
    ip = column_count("in-progress")
    limit = batch_wip_limit()
    wip_flag = " ⚠ over limit" if ip > limit else ""
    if fm_b:
        out.append(f"**Active batch:** {fm_b.get('id','?')} · "
                   f"caps `{fm_b.get('capabilities','[]')}` · "
                   f"WIP {ip}/{limit}{wip_flag}\n")
    else:
        out.append(f"**Active batch:** none (Gate 3 open) · WIP {ip}/{limit}{wip_flag}\n")

    # Exception queue (#8): blocked items needing a human, pulled to the top.
    blocked = [fm for fm in all_stories() if fm["_column"] == "blocked"]
    if blocked:
        out.append("**Exception queue:**")
        for fm in sorted(blocked, key=lambda f: f.get("id", "")):
            reason = (fm.get("blocked_reason") or "unspecified").strip()
            tag = "🔶 decision" if DECISION_SIGNAL.search(reason) else "process"
            out.append(f"- **{fm.get('id','?')}** ({tag}) — {reason}")
        out.append("")

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

    # Gate 3 + WIP (#6, #7): at most one active batch, and in-progress within cap.
    batches = all_batches()
    actives = active_batches()
    for fm, _ in batches:
        bid = fm.get("id", "?")
        if not BATCH_ID.match(bid):
            problems.append(f"{bid}: invalid batch id format (use BATCH-NNN)")
        if not id_matches_filename(bid, fm["_path"]):
            problems.append(f"{bid}: frontmatter id does not match filename")
    if len(actives) > 1:
        ids = ", ".join(fm.get("id", "?") for fm, _ in actives)
        problems.append(
            f"{len(actives)} active batches ({ids}); only one may be active "
            f"— close the others (Gate 3 is a single commitment)"
        )
    ip = column_count("in-progress")
    limit = batch_wip_limit()
    if ip > limit:
        problems.append(
            f"WIP breach: {ip} stories in-progress (limit {limit}) — finish or "
            f"defer one, or raise the active batch's wip_limit (Gate 3)"
        )

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
        for fm, _ in actives:
            bid = fm.get("id", "?")
            for cap in batch_capabilities(fm):
                if caps and cap not in caps:
                    problems.append(f"{bid}: unknown capability {cap} (not a SAD#3 cap)")

    if problems:
        print("INVARIANT VIOLATIONS:")
        for p in problems:
            print("  - " + p)
        _log("validate", outcome="refused", message=f"{len(problems)} violations", count=len(problems))
        sys.exit(1)
    print("ok: no invariant violations")
    _log("validate", message="no violations")


def run_review_check(fm, body, base):
    """Core anti-cheat checks. Return (problems, warnings) — no logging, no exit.

    Shared by the `review-check` command and the hard gate on move review/done.
    """
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
            # Workflow-system paths are tooling-managed and change continually,
            # independent of any single story's code change: backlog data, the
            # board/hook tooling, Claude Code config, the board's audit log, and
            # docs. None of these count against a story's Touch scope.
            return (
                f.startswith("backlog/")
                or f.startswith("tools/")
                or f.startswith(".claude/")
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

    return problems, warnings


def cmd_review_check(args):
    """Did the loop cheat? Check scope adherence + test integrity before done."""
    path = find_story(args.id)
    if not path:
        _fatal(f"error: {args.id} not found", event="review-check", story_id=args.id)
    fm, body = read_story(path)
    base = args.base
    problems, warnings = run_review_check(fm, body, base)

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
    m.add_argument("--base", default="",
                   help="git ref for the review/done review-check gate "
                        "(default: the story's stamped base_commit)")
    m.add_argument("--skip-review-check", action="store_true",
                   help="human override: move to review/done despite review-check "
                        "problems (logged as an override)")
    m.set_defaults(fn=cmd_move)

    l = sub.add_parser("list"); l.add_argument("--column"); l.add_argument("--capability")
    l.add_argument("--target"); l.add_argument("--json", action="store_true")
    l.set_defaults(fn=cmd_list)

    n = sub.add_parser("new"); n.add_argument("--capability", required=True)
    n.add_argument("--parent", required=True); n.add_argument("--id"); n.add_argument("--title")
    n.set_defaults(fn=cmd_new)

    ck = sub.add_parser("check")
    ck.add_argument("id")
    ck.add_argument("--criterion", help="substring of the criterion to (un)tick")
    ck.add_argument("--all", action="store_true", help="(un)tick every criterion")
    ck.add_argument("--uncheck", action="store_true", help="clear instead of tick")
    ck.set_defaults(fn=cmd_check)

    st = sub.add_parser("set")
    st.add_argument("id"); st.add_argument("field"); st.add_argument("value")
    st.set_defaults(fn=cmd_set)

    rj = sub.add_parser("reject")
    rj.add_argument("id")
    rj.add_argument("--reason", required=True, help="rework brief read by the loop on re-entry")
    rj.set_defaults(fn=cmd_reject)

    bn = sub.add_parser("batch-new", help="Gate 3: commit a batch of capabilities")
    bn.add_argument("--capabilities", required=True, help="comma-separated CAP ids")
    bn.add_argument("--goal", help="one-line batch goal")
    bn.add_argument("--wip", type=int, help=f"in-progress WIP limit (default {DEFAULT_WIP_LIMIT})")
    bn.add_argument("--id", help="BATCH-NNN (default: auto-numbered)")
    bn.set_defaults(fn=cmd_batch_new)

    bc = sub.add_parser("batch-close", help="close a batch (Gate-3 commitment done)")
    bc.add_argument("id")
    bc.set_defaults(fn=cmd_batch_close)

    bl = sub.add_parser("batch-list", help="show batches + live WIP usage")
    bl.add_argument("--json", action="store_true")
    bl.set_defaults(fn=cmd_batch_list)

    ex = sub.add_parser("exceptions", help="Gate 2/5 queue: blocked work needing a human")
    ex.add_argument("--json", action="store_true")
    ex.set_defaults(fn=cmd_exceptions)

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
