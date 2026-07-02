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
  move <id> <column> [--reason TEXT] [--base REF] [--skip-review-check] [--skip-ready]
      moving to `review`/`done` runs the review-check gate against the story's
      stamped base_commit and is REFUSED on problems unless --skip-review-check.
      moving to `in-progress` enforces the Definition of Ready (#5) — real
      acceptance criteria, a declared Touch scope, a valid capability — REFUSED
      unless --skip-ready.
  list [--column C] [--capability ID] [--target T] [--json]
  new --capability ID --parent FEAT-ID [--id STORY-NNN] [--title ...]
  new-epic|new-feature|new-plan|new-sad [--parent ID] [--id ID] [--title ...]
      Gate-free authoring scaffold: auto-number the next id and write a file
      from the matching template (closes F10, the manual-ID-assignment touch).
  check <id> [--criterion SUBSTR | --all] [--uncheck]  # tick acceptance criteria
  set <id> <field> <value>      # set an allowlisted frontmatter field (e.g. sad_refs)
  reject <id> --reason TEXT     # Acceptance-gate reject: review -> in-progress, re-enters loop
  batch-new --capabilities CAP-a,CAP-b [--goal ...] [--wip N] [--id BATCH-NNN]
      Commit gate: record the committed batch (capabilities + WIP limit); one active
      batch at a time. The active batch's wip_limit caps in-progress.
  batch-close <id>              # close a batch once its commitment is complete
  batch-list [--json]           # batches + live WIP usage
  status [--json]               # where am I on the workflow spine + the next
      step: a named-stage strip (Vision→Architecture→Commit→Build→Acceptance→
      Done) with a "you are here" marker, inferred live from board state.
  sprint-retro [--batch BATCH-NNN] [--accept P-N] [--reject P-N]
      Sprint STEP 2: retro a CLOSED sprint. No flags scaffold RETRO-NNN
      (committed-vs-shipped + a frozen windowed metrics snapshot + an empty
      proposal table). --accept flips a proposal to accepted AND spawns an IDEA
      (Vision-gate landing, capture≠commit); --reject flips it to rejected.
  idea-new [--title --born-from --found-by --why --discovery-type --id]
      Capture an out-of-scope discovery into the firewalled inbox (#16). The
      same writer backs sprint-retro --accept.
  idea-list [--json]            # the firewalled idea inbox (id, born_from, age)
  idea-archive [--days N] [--dry-run]
      Archive inbox ideas older than N days (default STALE_IDEA_DAYS) to
      backlog/ideas/archive/, keeping the live inbox high-signal (A5).
  exceptions [--json]           # Exception gate queue: blocked work split decision vs process
  show <id>
  render            # write a human-readable board.md (pure read, not state)
  render-html       # write a self-contained backlog/index.html with three tabs:
                    # a kanban board (columns + WIP/batch/blocked banners), an
                    # EPIC→FEATURE→STORY→SAD traceability tree, and SAD-anchor
                    # coverage (leaf anchors no story reaches + dangling refs).
                    # `validate` nudges (non-blocking) when this view is stale.
  validate          # check invariants across the whole board (incl. WIP + batch)
  metrics [--json] [--sprint BATCH-NNN | --since D --until D]
                    # retrospective off events.jsonl: cycle time, refusal/bounce
                    # rate, attempts spread, blocked time, demo-sweep (F7) flag.
                    # --sprint scopes every aggregate to that sprint's window.
  logs [--tail N]   # show workflow audit log (.workflow/events.jsonl)
"""
import argparse, difflib, glob, json, os, re, sys, shutil

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
IDEA_TEMPLATE = os.path.join(IDEAS, "IDEA.template.md")
# Ideas not promoted off the inbox land here (A5 stale-idea archival), keeping the
# live inbox high-signal without losing the provenance trail.
IDEA_ARCHIVE = os.path.join(IDEAS, "archive")
# Retrospectives (sprint STEP 2): a retro is a distinct lifecycle object from the
# batch — authored at close, it freezes a metrics snapshot and its proposal
# statuses keep mutating after the sprint closes, so it gets its own file.
RETROS = os.path.join(ROOT, "backlog", "retros")
# Optional ledger of SAD#3 capabilities consciously NOT scheduled yet, so the
# coverage invariant (#10) can tell "deferred on purpose" from "silently dropped".
DEFERRED_CAPS = os.path.join(ROOT, "backlog", "deferred-capabilities.md")
# Anchors may be document-qualified (`SAD-002#5.1`) now that multiple SADs
# coexist, or bare (`SAD#5.1`) for the original single-SAD backlog. Both forms
# are recognised everywhere refs and capabilities are parsed.
ANCHOR_RE = re.compile(r"(?:SAD-\d{3}#|SAD#)\d+(?:\.\d+)*")
CAPABILITY_RE = re.compile(r"### (?:SAD-\d{3}#|SAD#)3(?:\.\d+)?\s+([\w.*-]+):")
# Predicate for an individual sad_ref token (qualified or bare).
SAD_REF_RE = re.compile(r"^SAD(?:-\d{3})?#")
IDEA_ID = re.compile(r"^IDEA-\d{3}$")
PLAN_ID = re.compile(r"^PLAN-\d{3}$")
SAD_ID = re.compile(r"^SAD-\d{3}$")
EPIC_ID = re.compile(r"^EPIC-\d{3}$")
FEAT_ID = re.compile(r"^FEAT-\d{3}$")
STORY_ID = re.compile(r"^STORY-\d{3}$")
BATCH_ID = re.compile(r"^BATCH-\d{3}$")
RETRO_ID = re.compile(r"^RETRO-\d{3}$")
SENTINELS = ("", "[]", "~", "None")

# Auto-numbered authoring artifacts (#14, closes F10). Each entry:
#   dir, id-prefix, parent-id matcher (None = no parent field), parent-required.
# `new` already auto-numbers stories; these extend it to the rest of the chain.
ITEM_KINDS = {
    "epic":    (EPICS,     "EPIC", None,     False),
    "feature": (FEATURES,  "FEAT", EPIC_ID,  True),
    "plan":    (PLANS,     "PLAN", None,     False),
    "sad":     (SAD_DIR,   "SAD",  PLAN_ID,  False),
}

# Commit gate: how many stories may sit in-progress at once when no active batch
# overrides it. The cap turns "fan debt out into the backlog" (F3) into a visible
# signal — at the limit you must finish or explicitly defer, not silently widen WIP.
DEFAULT_WIP_LIMIT = 3
# A5: an inbox idea not promoted within this many days (measured from its
# `captured` stamp) is stale — `idea-archive` moves it to backlog/ideas/archive/
# and `validate` nudges. Keeps the inbox a signal, not a graveyard.
STALE_IDEA_DAYS = 90
# Exception queue (#8): a blocked_reason mentioning any of these reads as a
# decision only a human can make (architecture / vendor / legal) → Exception gate,
# versus an ordinary process block an agent can clear itself.
DECISION_SIGNAL = re.compile(
    r"\b(ADR|SAD#|vendor|legal|licen[sc]e|licensing|architecture|sign-?off)\b",
    re.I,
)

# ---------- workflow stages (the named gates + the build region) ----------
# The spine every project travels, plus the human-decision gates along it. These
# NAMES replace the old "Gate 1..5" numbering: the numbers implied one linear
# 1→2→3→4→5 run, but the Acceptance gate fires once per story *inside* the loop
# and the Exception gate is a side-channel reachable from anywhere — the sequence
# the numbers implied never existed. Descriptive names double as the "what's the
# next step" signal `board.py status` surfaces. Legend for old artifacts:
#   Gate 1 → Vision · Gate 2 → Architecture · Gate 3 → Commit
#   Gate 4 → Acceptance · Gate 5 → Exception
STAGES = [
    ("vision",       "Vision gate",       "plan + non-goals approved"),
    ("architecture", "Architecture gate", "SAD approved + ADRs decided"),
    ("commit",       "Commit gate",       "batch: capabilities + WIP limit"),
    ("build",        "Build loop",        "implement → code-review → review-check"),
    ("acceptance",   "Acceptance gate",   "human diff sign-off"),
    ("done",         "Done",              "shipped"),
]
# The Exception gate is orthogonal to the strip (blocked / SAD-conflict, off to
# the side), so it is surfaced separately rather than as a strip position.
EXCEPTION_GATE = ("exception", "Exception gate", "blocked / SAD conflict")


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
                if SAD_REF_RE.match(p.strip())]
    if "," in v:
        return [p.strip() for p in v.split(",") if SAD_REF_RE.match(p.strip())]
    return [v] if SAD_REF_RE.match(v) else []


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


# ---------- batch (Commit gate) + WIP helpers ----------
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


def committed_stories(fm):
    """The STORY ids a sprint (batch) committed to, from the `stories:` field."""
    return parse_list(fm.get("stories"))


def find_batch(bid):
    """Return (fm, body) for a batch id, or (None, None) if absent."""
    path = os.path.join(BATCHES, f"{bid}.md")
    if os.path.exists(path):
        return read_backlog_file(path)
    return None, None


def all_ideas():
    """Return fm for every live inbox IDEA-NNN.md (excludes the template and the
    archive/ subdir — glob is non-recursive, so archived ideas never match)."""
    out = []
    for p in sorted(glob.glob(os.path.join(IDEAS, "IDEA-*.md"))):
        if p.endswith(".template.md"):
            continue
        fm, _ = read_backlog_file(p)
        out.append(fm)
    return out


def idea_age_days(fm, today):
    """Days since an idea was captured, or None if the `captured` stamp is absent
    or unparseable."""
    from datetime import datetime
    captured = (fm.get("captured") or "").strip()
    try:
        return (today - datetime.fromisoformat(captured).date()).days
    except (ValueError, TypeError):
        return None


def all_retros():
    """Return (fm, body) for every RETRO-NNN.md, newest id last."""
    out = []
    for p in sorted(glob.glob(os.path.join(RETROS, "RETRO-*.md"))):
        if p.endswith(".template.md"):
            continue
        out.append(read_backlog_file(p))
    return out


def latest_closed_batch():
    """(fm, body) of the highest-id closed batch, or (None, None)."""
    closed = [(fm, b) for fm, b in all_batches()
              if (fm.get("status") or "").strip() == "closed"]
    return closed[-1] if closed else (None, None)


# ---------- retro proposal-table parsing ----------
# Proposals live as a markdown table in the RETRO body; each row is
#   | P-N | target | type | status | result |
# Parsed by id so `sprint-retro --accept/--reject` can flip one row in place.
PROPOSAL_ROW = re.compile(r"^\s*\|\s*(P-\d+)\s*\|")


def parse_proposal_row(line):
    """Cells of a `| P-N | … |` row (id, target, type, status, result), or None."""
    if not PROPOSAL_ROW.match(line):
        return None
    return [c.strip() for c in line.strip().strip("|").split("|")]


def proposal_rows(body):
    """All parsed proposal rows in a retro body."""
    return [c for c in (parse_proposal_row(l) for l in (body or "").splitlines()) if c]


PREP_LINE = re.compile(r"^\s*-\s*(story|idea|note)\s*:\s*(\S+)\s*(?:[—\-–]\s*(.*))?$",
                       re.I)


def parse_prep(body):
    """Parse the `## Preparation / enablers` block into (kind, id, why) tuples.

    Three kinds keep "preparation work that makes future sprints easier" honest:
      - story: an enabler that is real, anchored, and committed THIS sprint
      - idea:  forward groundwork, firewalled from the build loop (capture≠commit)
      - note:  a bare planning thought with no id — inert by construction
    """
    m = re.search(r"##\s*Preparation\s*/\s*enablers\s*\n(.*?)(\n##|\Z)", body, re.DOTALL)
    if not m:
        return []
    out = []
    for line in m.group(1).splitlines():
        pm = PREP_LINE.match(line)
        if pm:
            out.append((pm.group(1).lower(), pm.group(2).strip(),
                        (pm.group(3) or "").strip()))
    return out


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


PLACEHOLDER = re.compile(r"<[^>]+>")


def real_criteria(body):
    """Acceptance-criteria lines that carry a real, non-placeholder requirement."""
    m = re.search(r"##\s*Acceptance Criteria\s*\n(.*?)(\n##|\Z)", body, re.DOTALL)
    if not m:
        return []
    out = []
    for line in m.group(1).splitlines():
        bm = re.match(r"^\s*-\s*\[( |x|X)\]\s*(.*\S)?\s*$", line)
        if not bm:
            continue
        text = (bm.group(2) or "").strip()
        if text and not PLACEHOLDER.search(text):
            out.append(text)
    return out


def has_status_section(body):
    """True if the story still carries the deprecated `## Status` prose (F6/#12)."""
    return bool(re.search(r"^##\s*Status\s*$", body, re.MULTILINE))


def definition_of_ready(fm, body):
    """Machine-checkable Definition of Ready, enforced at `move in-progress` (#5).

    Beyond the long-standing `sad_refs` gate: a story is only ready to start when
    it states real acceptance criteria, declares a Touch scope (closing the
    "no scope = pass" loophole), and names a valid capability. Returns a list of
    problems (empty = ready).
    """
    problems = []
    cap = (fm.get("capability") or "").strip()
    if not cap or cap in SENTINELS or PLACEHOLDER.search(cap):
        problems.append("no valid capability (still a placeholder)")
    if not real_criteria(body):
        problems.append("no real acceptance criteria (empty or placeholder)")
    if not touch_scope(body):
        problems.append("no Touch scope declared (cannot bound the change)")
    return problems


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


def sad_status(text):
    """Return the SAD's frontmatter `status` (Draft|Reviewed|Approved), or ''."""
    fm, _ = split_fm(text)
    return ((fm or {}).get("status") or "").strip()


def sad_out_of_scope_tokens(text):
    """Concrete code-span identifiers named in `SAD#1.2` (out of scope).

    SAD#1.2 is prose, so we mechanise only the unambiguous half: the backtick-
    quoted artifacts a story must never build against (e.g. `dc-runtime`,
    `mulberry32`, `<x-dc>`). A token must look like a real identifier/path —
    plain English in backticks is ignored to avoid false positives.
    """
    m = re.search(r"###\s*(?:SAD-\d{3}#|SAD#)1\.2\b.*?\n(.*?)(\n###|\n##\s|\Z)",
                  text, re.DOTALL)
    if not m:
        return set()
    tokens = set()
    for span in re.findall(r"`([^`]+)`", m.group(1)):
        s = span.strip()
        if re.search(r"[./<>-]", s) and not re.search(r"\s", s) and len(s) >= 3:
            tokens.add(s)
    return tokens


def deferred_capabilities():
    """CAP ids consciously deferred (optional ledger), so coverage (#10) can tell
    a deliberate deferral from a silent capability drop. Lines like `- CAP-x: …`."""
    if not os.path.exists(DEFERRED_CAPS):
        return {}
    out = {}
    with open(DEFERRED_CAPS, encoding="utf-8") as f:
        for line in f:
            mm = re.match(r"\s*-\s*(CAP-[\w.-]+)\s*[:\-—]?\s*(.*)$", line)
            if mm:
                out[mm.group(1).strip()] = mm.group(2).strip()
    return out


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
    # Definition of Ready (#5): don't start work that isn't ready. sad_refs is
    # already gated above; here we add real criteria, a declared Touch scope, and
    # a valid capability. Overridable, like the review-check gate, with a flag.
    if dst == "in-progress":
        not_ready = definition_of_ready(fm, body)
        if not_ready and not args.skip_ready:
            print(f"NOT READY for {args.id} (Definition of Ready):")
            for p in not_ready:
                print("  ✗ " + p)
            msg = f"definition-of-ready: {len(not_ready)} problem(s)"
            _log("move", outcome="refused", message=msg, story_id=args.id,
                 count=len(not_ready), **{"from": src, "to": dst})
            sys.exit(f"refused: {msg}. Fix, or re-run with --skip-ready to override.")
        if not_ready and args.skip_ready:
            _log("move", outcome="override", story_id=args.id,
                 message=f"--skip-ready over {len(not_ready)} problem(s)",
                 count=len(not_ready), **{"from": src, "to": dst})
    if dst == "done":
        n = unchecked_criteria(body)
        if n:
            msg = f"{args.id} has {n} unchecked acceptance criteria"
            _log("move", outcome="refused", message=msg, story_id=args.id, **{"from": src, "to": dst})
            sys.exit(f"refused: {msg}")

    # WIP signal (#6): starting work past the limit is allowed but SURFACED, not
    # silent — the loop keeps moving while making overload visible at the Commit gate. src
    # is never in-progress here (same-column moves are refused above), so the new
    # post-move count is current + 1.
    if dst == "in-progress":
        limit = batch_wip_limit()
        post = column_count("in-progress") + 1
        if post > limit:
            warn = (f"WIP at {post} in-progress (limit {limit}). Finish or defer "
                    f"one, or raise the batch wip_limit at the Commit gate.")
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

        # R-1: code-review gate -- require a fresh, clean code-reviewer artifact
        head = _git_run(["git", "rev-parse", "HEAD"]).strip()
        cr = code_review_problem(args.id, base, head)
        if cr and not args.skip_code_review:
            msg = f"code-review gate: {cr}"
            _log("move", outcome="refused", message=msg, story_id=args.id, base=base,
                 **{"from": src, "to": dst})
            sys.exit(f"refused: {msg}; fix, or override with --skip-code-review")
        if cr and args.skip_code_review:
            _log("move", outcome="override", story_id=args.id, base=base,
                 message=f"--skip-code-review: {cr}", **{"from": src, "to": dst})

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
    """Acceptance-gate reject: bounce a reviewed story back into the loop (Phase 2, #11).

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
    """Commit gate: record a sprint plan — the capabilities + stories you commit to.

    A batch IS the sprint container: a scope-boxed commitment (not a timebox).
    Beyond the capabilities and WIP limit, a sprint plan also names the specific
    stories pulled in, an execution strategy (how Claude Code agent teams run the
    work — what parallelises across worktrees vs sequences), and any
    preparation/enabler work that makes FUTURE sprints cheaper. Only one batch is
    active at a time, so this is the single standing answer to "what are we
    building now". `sprint-plan-new` is the sprint-vocabulary alias; running this
    command IS the human Commit-gate commitment (the planning team only prepared it).
    """
    caps = [c.strip() for c in (args.capabilities or "").split(",") if c.strip()]
    if not caps:
        _fatal("batch-new needs --capabilities CAP-a,CAP-b", event="batch-new")
    if active_batches():
        ids = ", ".join(fm.get("id", "?") for fm, _ in active_batches())
        _fatal(f"an active sprint already exists ({ids}); close it first "
               f"(board.py sprint-close <id>) — the Commit gate is one commitment at a time",
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
    stories = [s.strip() for s in (getattr(args, "stories", None) or "").split(",")
               if s.strip()]
    prep_items = [p.strip() for p in (getattr(args, "prep", None) or "").split(",")
                  if p.strip()]
    fm = {
        "id": bid,
        "type": "batch",
        "status": "active",
        "created": created,
        "wip_limit": wip,
        "capabilities": "[" + ", ".join(caps) + "]",
    }
    if stories:
        fm["stories"] = "[" + ", ".join(stories) + "]"
    cap_lines = "\n".join(f"- {c}" for c in caps)
    body = (f"\n## Goal\n"
            f"{args.goal or '<sprint goal — one falsifiable outcome, not a task list>'}\n\n"
            f"## Capabilities committed\n{cap_lines}\n\n")
    if stories:
        body += ("## Stories committed\n"
                 + "\n".join(f"- {s} — <why it's in this sprint>" for s in stories)
                 + "\n\n")
    body += ("## Execution strategy\n"
             + (getattr(args, "exec_strategy", None)
                or "<how Claude Code agent teams run this — what parallelises across "
                   "worktrees vs sequences, where a fan-out of reviewers helps>")
             + "\n\n")
    body += ("## Preparation / enablers\n"
             + ("\n".join(f"- {p}" for p in prep_items) if prep_items else
                "<enabler/spike/techdebt/tooling that makes FUTURE sprints easier; "
                "one per line as story:ID (committed) · idea:ID (firewalled "
                "groundwork) · note:text>")
             + "\n\n## Notes\n")
    os.makedirs(BATCHES, exist_ok=True)
    out = os.path.join(BATCHES, f"{bid}.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    print(f"created {bid} (active): caps={caps}"
          + (f" stories={stories}" if stories else "") + f" wip_limit={wip}")
    _log("batch-new",
         message=f"caps={','.join(caps)} stories={','.join(stories)} wip={wip}",
         batch_id=bid, count=len(caps))


def cmd_batch_close(args):
    """Close a batch — the Commit-gate commitment is complete, freeing the next one."""
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
        print("(no batches — board.py batch-new --capabilities … to open the Commit gate)")
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


def _workflow_position():
    """Infer where the project sits on the workflow spine from board state.

    Read-only. Returns a dict: stage key, headline, next step, sprint one-liner,
    detail lines, and the blocked count (Exception gate). Upstream authoring gates
    (Vision, Architecture) are implicitly passed once a backlog exists on the
    board — board.py only observes the live build region, so it reports from
    Commit onward and points at the authoring commands when the board is empty.
    """
    by_col = {}
    for s in all_stories():
        by_col.setdefault(s["_column"], []).append(s.get("id"))
    counts = {c: len(by_col.get(c, [])) for c in COLUMNS}
    blocked = counts["blocked"]
    fm, _ = active_batch()

    if not fm:
        if counts["todo"] or counts["in-progress"] or counts["review"]:
            return {"stage": "commit", "sprint": "",
                    "headline": "no sprint committed — stories are waiting on the board",
                    "next": "commit a sprint: board.py sprint-plan-new --capabilities … "
                            "(the Gate-free planning team prepares; this is your Commit)",
                    "detail": [f"todo {counts['todo']} · in-progress "
                               f"{counts['in-progress']} · review {counts['review']}"],
                    "blocked": blocked}
        return {"stage": "architecture", "sprint": "",
                "headline": "no active sprint and no work on the board",
                "next": "author upstream: /refine-idea → /plan-to-sad → "
                        "/sad-to-backlog, then commit a sprint",
                "detail": [], "blocked": blocked}

    bid = fm.get("id", "?")
    committed = committed_stories(fm)
    cols = {s.get("id"): s["_column"] for s in all_stories()}
    done = sum(1 for sid in committed if cols.get(sid) == "done")
    ip, limit = counts["in-progress"], batch_wip_limit()
    sprint = f"{bid} [active] · {done}/{len(committed)} committed done · WIP {ip}/{limit}"

    review = sorted(by_col.get("review", []))
    in_prog = sorted(by_col.get("in-progress", []))
    committed_todo = sorted(sid for sid in committed if cols.get(sid) == "todo")

    if review:
        rid = review[0]
        return {"stage": "acceptance", "sprint": sprint, "blocked": blocked,
                "headline": f"{rid} is in review, awaiting your sign-off",
                "next": f"review the diff → accept (board.py move {rid} done) "
                        f"or bounce (board.py reject {rid} --reason …)",
                "detail": [f"in review: {', '.join(review)}"] if len(review) > 1 else []}
    if in_prog:
        pid = in_prog[0]
        return {"stage": "build", "sprint": sprint, "blocked": blocked,
                "headline": f"{pid} is in progress (Build loop)",
                "next": f"finish {pid} → board.py review-check {pid} → "
                        f"board.py move {pid} review",
                "detail": [f"in progress: {', '.join(in_prog)}"] if len(in_prog) > 1 else []}
    if committed_todo:
        sid = committed_todo[0]
        return {"stage": "build", "sprint": sprint, "blocked": blocked,
                "headline": "sprint committed, no story started yet (Build loop entry)",
                "next": f"start a committed story: board.py move {sid} in-progress",
                "detail": [f"committed & waiting: {', '.join(committed_todo)}"]}
    if committed and done == len(committed):
        return {"stage": "done", "sprint": sprint, "blocked": blocked,
                "headline": f"all {done} committed stories are done — sprint complete",
                "next": f"close it (board.py sprint-close {bid}) and plan the next "
                        f"(board.py sprint-retro → sprint-plan-new)",
                "detail": []}
    return {"stage": "build", "sprint": sprint, "blocked": blocked,
            "headline": "sprint active — no committed story is todo/in-progress/review",
            "next": "check board.py sprint-show for drift, or commit more work",
            "detail": []}


def _render_stage_strip(here_key):
    """One-line strip of stage names with the current stage marked ▶…◀."""
    keys = [k for k, _, _ in STAGES]
    idx = keys.index(here_key) if here_key in keys else -1
    cells = [(f"▶{name}◀" if i == idx else name)
             for i, (_, name, _) in enumerate(STAGES)]
    return " → ".join(cells)


def cmd_status(args):
    """Where am I in the workflow, and what's the next step? A stage strip with a
    'you are here' marker over the named gates, plus the concrete next command —
    inferred live from board state. Read-only; touches nothing."""
    pos = _workflow_position()
    if getattr(args, "json", False):
        print(json.dumps({k: v for k, v in pos.items()}, indent=2))
        return
    print("Workflow ▸ " + _render_stage_strip(pos["stage"]))
    print(f"           (Exception gate handles blocked / SAD-conflict, off to the side)")
    print()
    print(f"You are here : {pos['headline']}")
    if pos["sprint"]:
        print(f"Sprint       : {pos['sprint']}")
    for d in pos["detail"]:
        print(f"               {d}")
    print(f"Next step    : {pos['next']}")
    if pos["blocked"]:
        print(f"⚠ Exception  : {pos['blocked']} blocked — clear via board.py exceptions")
    _log("status", stage=pos["stage"])


def _sprint_goal(body):
    """The one-line `## Goal` of a sprint, or '' if unset/placeholder."""
    m = re.search(r"##\s*Goal\s*\n(.+)", body or "")
    g = m.group(1).strip() if m else ""
    return "" if g.startswith("<") else g


def cmd_sprint_show(args):
    """Detailed single-sprint view (active by default): goal, committed stories
    with their LIVE board column, prep/enablers, and WIP usage — the at-a-glance
    "are we on track for the sprint goal" surface that `batch-list` is too terse
    to give. Read-only; touches nothing.
    """
    if getattr(args, "id", None):
        path = os.path.join(BATCHES, f"{args.id}.md")
        if not os.path.exists(path):
            _fatal(f"{args.id} not found in backlog/batches/", event="sprint-show")
        fm, body = read_backlog_file(path)
    else:
        fm, body = active_batch()
        if not fm:
            print("no active sprint (Commit gate open) — "
                  "board.py sprint-plan-new … to open one")
            return
    cols = {s.get("id"): s["_column"] for s in all_stories()}
    caps = batch_capabilities(fm)
    committed = committed_stories(fm)
    is_active = (fm.get("status") or "").strip() == "active"
    ip = column_count("in-progress")
    limit = batch_wip_limit() if is_active else fm.get("wip_limit", "?")
    prep = parse_prep(body)
    rows = []
    for sid in committed:
        col = cols.get(sid)
        scap = None
        sp = find_story(sid)
        if sp:
            sfm, _ = read_story(sp)
            scap = (sfm.get("capability") or "").strip() or None
        rows.append({"id": sid, "column": col or "(not on board)",
                     "capability": scap,
                     "drift": bool(scap and caps and scap not in caps)})
    if getattr(args, "json", False):
        print(json.dumps({
            "id": fm.get("id", "?"), "status": fm.get("status", "?"),
            "created": fm.get("created", "?"), "goal": _sprint_goal(body),
            "capabilities": caps, "wip": {"in_progress": ip, "limit": limit},
            "stories": rows,
            "prep": [{"kind": k, "id": i, "why": w} for k, i, w in prep],
        }, indent=2))
        return
    print(f"{fm.get('id','?')} [{fm.get('status','?')}] · created {fm.get('created','?')}")
    print(f"  Goal: {_sprint_goal(body) or '(unset)'}")
    print(f"  Capabilities: {', '.join(caps) or '(none)'}")
    print(f"  WIP: {ip}/{limit}")
    if rows:
        done = sum(1 for r in rows if r["column"] == "done")
        print(f"  Committed stories ({done}/{len(rows)} done):")
        for r in rows:
            drift = f"  ⚠ cap {r['capability']} outside sprint" if r["drift"] else ""
            print(f"    {r['id']:<12} ▸ {r['column']}{drift}")
    if prep:
        print("  Preparation / enablers:")
        tag = {"story": "committed", "idea": "firewalled", "note": "inert"}
        for kind, pid, why in prep:
            print(f"    [{kind}] {pid} ({tag.get(kind, kind)})"
                  + (f" — {why}" if why else ""))
    _log("sprint-show", batch_id=fm.get("id", "?"))


def cmd_exceptions(args):
    """Exception gate queue (#8): everything stuck waiting on a human, in one place.

    Blocked stories are split into the ones an agent cannot clear — architecture,
    vendor, or legal decisions (Exception gate) — and ordinary process blocks. This is
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
            "gate": "Exception gate" if kind == "decision" else "agent/SM",
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
        print("  ▼ NEEDS A HUMAN DECISION (Exception gate):")
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


def _next_item_id(dirpath, prefix):
    nums = []
    for p in glob.glob(os.path.join(dirpath, f"{prefix}-*.md")):
        if p.endswith(".template.md"):
            continue
        mm = re.search(rf"{prefix}-(\d+)", os.path.basename(p))
        if mm:
            nums.append(int(mm.group(1)))
    return f"{prefix}-{(max(nums) + 1 if nums else 1):03d}"


def cmd_new_item(args):
    """Auto-number and scaffold an epic/feature/plan/sad from its template (#14).

    Removes the last manual-ID-assignment touch (F10): ids never collide because
    board.py is the single allocator, exactly as it already is for stories.
    """
    kind = args.kind
    dirpath, prefix, parent_re, parent_required = ITEM_KINDS[kind]
    id_re = {"epic": EPIC_ID, "feature": FEAT_ID, "plan": PLAN_ID, "sad": SAD_ID}[kind]

    new_id = args.id or _next_item_id(dirpath, prefix)
    if not id_re.match(new_id):
        _fatal(f"{new_id}: invalid {kind} id (use {prefix}-NNN)", event="new-" + kind)
    if os.path.exists(os.path.join(dirpath, f"{new_id}.md")):
        _fatal(f"{new_id} already exists", event="new-" + kind)

    parent = (args.parent or "").strip()
    if parent_required and not parent:
        _fatal(f"new-{kind} needs --parent ({parent_re.pattern})", event="new-" + kind)
    if parent and parent_re and not parent_re.match(parent):
        _fatal(f"{parent}: bad parent id for {kind}", event="new-" + kind)
    if parent and parent_re is EPIC_ID and not epic_exists(parent):
        _fatal(f"parent epic {parent} not found", event="new-" + kind)
    if parent and parent_re is PLAN_ID and not os.path.exists(os.path.join(PLANS, f"{parent}.md")):
        _fatal(f"parent plan {parent} not found", event="new-" + kind)

    tpl_path = os.path.join(dirpath, f"{prefix}.template.md")
    if not os.path.exists(tpl_path):
        _fatal(f"missing template {tpl_path}", event="new-" + kind)
    with open(tpl_path, encoding="utf-8") as f:
        fm, body = split_fm(f.read())
    fm = fm or {}
    fm["id"] = new_id
    if parent and "parent" in fm:
        fm["parent"] = parent
    if args.title:
        body = re.sub(r"(^#\s+)[^\n]*", rf"\g<1>{new_id} — {args.title}",
                      body, count=1, flags=re.MULTILINE)
    os.makedirs(dirpath, exist_ok=True)
    out = os.path.join(dirpath, f"{new_id}.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    print(f"created {new_id} in {os.path.relpath(dirpath, ROOT)}/"
          + (f"  (parent {parent})" if parent else ""))
    _log("new-" + kind, message=new_id, **({"parent": parent} if parent else {}))


def _write_idea(title=None, born_from=None, why=None, found_by=None,
                discovery_type="out-of-scope", idea_id=None):
    """Allocate + write a provenance-stamped IDEA to the inbox — the #16
    return-edge (capture≠commit).

    Shared by `idea-new` and `sprint-retro --accept`, so a retro's accepted
    workflow-change proposal lands exactly like an in-flow discovery: in the
    inbox, firewalled from the build loop until a human promotes it at the Vision gate.
    Returns the new IDEA id.
    """
    from datetime import datetime, timezone
    os.makedirs(IDEAS, exist_ok=True)
    new_id = idea_id or _next_item_id(IDEAS, "IDEA")
    if not IDEA_ID.match(new_id):
        _fatal(f"{new_id}: invalid idea id (use IDEA-NNN)", event="idea-new")
    if os.path.exists(os.path.join(IDEAS, f"{new_id}.md")):
        _fatal(f"{new_id} already exists", event="idea-new")
    captured = datetime.now(timezone.utc).date().isoformat()
    fm = {
        "id": new_id,
        "type": "idea",
        "status": "inbox",
        "captured": captured,
        "discovery_type": (discovery_type or "out-of-scope"),
        "born_from": born_from or "~",
        "found_by": found_by or "~",
        "why": why or "~",
    }
    body = (f"\n# {new_id} — {title or '<short title>'}\n\n"
            f"{why or 'Free-form concept: problem sketch, who it is for, rough scope.'}\n\n"
            f"_Capture≠commit: firewalled from the build loop until a human "
            f"promotes it through Vision gate (refine → plan → SAD amendment/ADR)._\n")
    out = os.path.join(IDEAS, f"{new_id}.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(dump_fm(fm, body))
    return new_id


def cmd_idea_new(args):
    """Gate-free capture of an out-of-scope discovery into the firewalled inbox."""
    new_id = _write_idea(title=args.title, born_from=args.born_from, why=args.why,
                         found_by=args.found_by,
                         discovery_type=args.discovery_type, idea_id=args.id)
    print(f"created {new_id} in backlog/ideas/ (inbox — firewalled from the build loop)")
    fields = {k: v for k, v in (("born_from", args.born_from),
                                ("found_by", args.found_by)) if v}
    _log("idea-new", message=new_id, **fields)


def cmd_idea_list(args):
    """Show the idea inbox (id, born_from, age, status) — the surface the PO lens
    and the triage loop read. Read-only."""
    from datetime import datetime, timezone
    ideas = all_ideas()
    if args.json:
        print(json.dumps([{k: v for k, v in fm.items() if not k.startswith("_")}
                          for fm in ideas], indent=2))
        return
    if not ideas:
        print("(idea inbox empty)")
        return
    today = datetime.now(timezone.utc).date()
    print(f"IDEA INBOX — {len(ideas)} (firewalled from the build loop; Vision gate promotes)\n")
    for fm in ideas:
        days = idea_age_days(fm, today)
        age = f"{days}d" if days is not None else "?"
        stale = " STALE" if (days is not None and days >= STALE_IDEA_DAYS
                             and (fm.get("status") or "").strip() == "inbox") else ""
        born = (fm.get("born_from") or "~").strip()
        print(f"  {fm.get('id','?'):<10} [{(fm.get('status') or '?').strip()}] "
              f"age {age:<5} born_from={born}{stale}")
    _log("idea-list", count=len(ideas))


def cmd_idea_archive(args):
    """A5 stale-idea archival: move inbox ideas older than --days (default
    STALE_IDEA_DAYS) into backlog/ideas/archive/, flipping status to `archived`
    and stamping the date. Keeps the live inbox high-signal; --dry-run previews.

    Only `status: inbox` ideas are touched — a promoted idea is never archived out
    from under its return-edge, and the move preserves the full provenance trail."""
    from datetime import datetime, timezone
    days = args.days if args.days is not None else STALE_IDEA_DAYS
    today = datetime.now(timezone.utc).date()
    stale = []
    for fm in all_ideas():
        if (fm.get("status") or "").strip() != "inbox":
            continue
        age = idea_age_days(fm, today)
        if age is not None and age >= days:
            stale.append((fm, age))
    if not stale:
        print(f"no inbox ideas older than {days}d — inbox is high-signal")
        return
    verb = "would archive" if args.dry_run else "archived"
    for fm, age in stale:
        iid = fm.get("id", "?")
        if args.dry_run:
            print(f"  {verb} {iid} (age {age}d)")
            continue
        os.makedirs(IDEA_ARCHIVE, exist_ok=True)
        src = fm["_path"]
        _, body = read_backlog_file(src)
        new_fm = {k: v for k, v in fm.items() if not k.startswith("_")}
        new_fm["status"] = "archived"
        new_fm["archived"] = today.isoformat()
        dst = os.path.join(IDEA_ARCHIVE, f"{iid}.md")
        with open(dst, "w", encoding="utf-8") as f:
            f.write(dump_fm(new_fm, body))
        os.remove(src)
        print(f"  {verb} {iid} (age {age}d) → backlog/ideas/archive/")
    if not args.dry_run:
        _log("idea-archive", count=len(stale), message=f">{days}d")
    print(f"\n{len(stale)} stale idea(s) {verb} (horizon {days}d)")


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
    # Normalize the query and criteria so punctuation like `()` and collapsed
    # whitespace don't silently break the substring match (#4: brittle matcher).
    def norm(s):
        return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s)).strip().lower()
    needle = norm(args.criterion) if args.criterion else ""
    # Group lines into criteria: a box line plus any wrapped continuation lines
    # (criteria often span several physical lines, so matching must consider the
    # whole text, not just the line that carries the checkbox). #4.
    crit_idx = None  # index of the current criterion's box line
    full = {}        # box-line index -> accumulated full text
    for i, line in enumerate(lines):
        bm = CRITERION_BOX.match(line)
        if bm:
            crit_idx = i
            full[i] = bm.group(3)
        elif crit_idx is not None:
            full[crit_idx] += " " + line
    available = [full[i].strip() for i in full]  # for diagnostics
    matched, changed = 0, 0
    for i in full:
        bm = CRITERION_BOX.match(lines[i])
        if args.all or (needle and needle in norm(full[i])):
            matched += 1
            is_checked = bm.group(2).lower() == "x"
            if is_checked != want:
                lines[i] = f"{bm.group(1)}[{'x' if want else ' '}]{bm.group(3)}"
                changed += 1
    if args.criterion and matched == 0:
        def tidy(t):
            t = re.sub(r"\s+", " ", t).strip()
            return t if len(t) <= 100 else t[:97] + "..."
        listing = "\n".join(f"    - {tidy(t)}" for t in available) or "    (none declared)"
        close = difflib.get_close_matches(
            needle, [norm(t) for t in available], n=1, cutoff=0.4)
        hint = ""
        if close:
            best = next(t for t in available if norm(t) == close[0])
            hint = f"\n  closest: {tidy(best)!r}"
        _fatal(f"no acceptance criterion matches '{args.criterion}' "
               f"(0 of {len(available)} matched).{hint}\n"
               f"  available criteria in {args.id} — pass a substring of one:\n{listing}",
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

    # Commit-gate header: the active sprint commitment + live WIP usage (#6, #7).
    fm_b, bbody = active_batch()
    ip = column_count("in-progress")
    limit = batch_wip_limit()
    wip_flag = " ⚠ over limit" if ip > limit else ""
    if fm_b:
        out.append(f"**Active sprint:** {fm_b.get('id','?')} · "
                   f"caps `{fm_b.get('capabilities','[]')}` · "
                   f"WIP {ip}/{limit}{wip_flag}")
        goal = _sprint_goal(bbody)
        if goal:
            out.append(f"> Goal: {goal}")
        committed = committed_stories(fm_b)
        if committed:
            cols = {s.get("id"): s["_column"] for s in all_stories()}
            done = sum(1 for s in committed if cols.get(s) == "done")
            chips = " · ".join(f"{s} ▸ {cols.get(s,'—')}" for s in committed)
            out.append(f"> Committed ({done}/{len(committed)} done): {chips}")
        prep = [(k, i) for k, i, _ in parse_prep(bbody) if not i.startswith("<")]
        if prep:
            out.append("> Prep: " + " · ".join(f"{i} ({k})" for k, i in prep))
        out.append("")
    else:
        out.append(f"**Active sprint:** none (Commit gate open) · WIP {ip}/{limit}{wip_flag}\n")

    # Retro banner (STEP 2): if the most-recently-closed sprint has a retro, show
    # it with the count of still-open proposals (the retro→Vision gate handoff surface).
    lc_fm, _ = latest_closed_batch()
    if lc_fm:
        rs = [(rf, rb) for rf, rb in all_retros()
              if (rf.get("batch") or "").strip() == lc_fm.get("id")]
        if rs:
            rfm, rbody = rs[-1]
            open_n = sum(1 for c in proposal_rows(rbody)
                         if len(c) > 3 and c[3] == "proposed")
            out.append(f"**Retro {rfm.get('id','?')}** ({lc_fm.get('id','?')}) · "
                       f"{open_n} proposal(s) open\n")

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

    # Idea inbox (#16 return-edge): the firewalled funnel, rendered apart from the
    # board columns precisely because it is NOT buildable work — Vision gate promotes an
    # idea before it can become a story. Surfaces provenance + staleness so the PO
    # lens / triage loop can read board.md alone (A8).
    from datetime import datetime, timezone
    ideas = all_ideas()
    today = datetime.now(timezone.utc).date()
    out.append(f"\n## Idea inbox ({len(ideas)})\n")
    out.append("_Firewalled from the build loop — capture≠commit; Vision gate promotes._\n")
    if not ideas:
        out.append("- (empty)")
    for fm in ideas:
        days = idea_age_days(fm, today)
        age = f"{days}d" if days is not None else "?"
        stale = " · ⚠ STALE" if (days is not None and days >= STALE_IDEA_DAYS
                                  and (fm.get("status") or "").strip() == "inbox") else ""
        born = (fm.get("born_from") or "~").strip()
        out.append(f"- **{fm.get('id','?')}** · age {age} · born_from `{born}`{stale}")

    p = os.path.join(ROOT, "board.md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"wrote {p}")


# ---------- render-html (self-contained backlog site) ----------
def _item_title(fm, body):
    """Title from a `# ID — Title` heading, else the id."""
    m = re.search(r"^#\s+\S+\s*[—\-–]\s*(.+)$", body, re.MULTILINE)
    return m.group(1).strip() if m else fm.get("id", "?")


def _story_title(fm, body):
    """Stories have no H1; fall back to the first line of the User Story."""
    m = re.search(r"^#\s+\S+\s*[—\-–]\s*(.+)$", body, re.MULTILINE)
    if m:
        return m.group(1).strip()
    m = re.search(r"##\s*User Story\s*\n+(.+)", body)
    if m:
        t = re.sub(r"\s+", " ", m.group(1)).strip()
        return (t[:90] + "…") if len(t) > 90 else t
    return fm.get("id", "?")


def _story_criteria(body):
    m = re.search(r"##\s*Acceptance Criteria\s*\n(.*?)(\n##|\Z)", body, re.DOTALL)
    if not m:
        return []
    out = []
    for line in m.group(1).splitlines():
        bm = re.match(r"^\s*-\s*\[( |x|X)\]\s*(.*)$", line)
        if bm and bm.group(2).strip():
            out.append({"done": bm.group(1).lower() == "x", "text": bm.group(2).strip()})
    return out


def _full_stories():
    """Every story with body-derived fields, ordered by column then id."""
    out = []
    for col in COLUMNS:
        for p in sorted(glob.glob(os.path.join(BOARD, col, "STORY-*.md"))):
            fm, body = read_story(p)
            crit = _story_criteria(body)
            out.append({
                "id": fm.get("id", os.path.splitext(os.path.basename(p))[0]),
                "column": col,
                "title": _story_title(fm, body),
                "capability": (fm.get("capability") or "").strip(),
                "parent": (fm.get("parent") or "").strip(),
                "sad_refs": parse_sad_refs(fm.get("sad_refs")),
                "attempts": (fm.get("attempts") or "").strip(),
                "target": (fm.get("target") or "").strip(),
                "blocked_reason": (fm.get("blocked_reason") or "").strip(),
                "prev_column": (fm.get("prev_column") or "").strip(),
                "criteria": crit,
                "criteria_done": sum(1 for c in crit if c["done"]),
                "criteria_total": len(crit),
            })
    return out


def _sentinel(v):
    v = (v or "").strip()
    return "" if v in SENTINELS else v


# Anchors come in both conventions: bare `SAD#x.y` (single-SAD, SAD-001) and
# the multi-SAD `SAD-002#x.y` form — mirror SAD_REF_RE so both parse.
SAD_ANCHOR_HEAD = re.compile(r"^(#{2,4})\s+(SAD(?:-\d{3})?#\d+(?:\.\d+)?)\b\s*(.*)$")


def parse_sad_anchors():
    """Every `## / ### SAD#x.y Title` heading across all SAD files, in order."""
    anchors = []
    for p in list_sad_files():
        sad_id = os.path.splitext(os.path.basename(p))[0]
        with open(p, encoding="utf-8") as f:
            for line in f:
                m = SAD_ANCHOR_HEAD.match(line.rstrip("\n"))
                if m:
                    anchors.append({
                        "id": m.group(2),
                        "level": len(m.group(1)),
                        "title": m.group(3).strip(),
                        "sad": sad_id,
                    })
    return anchors


def build_sad_coverage(stories, features, epics):
    """Anchor-by-anchor coverage: which stories pin each SAD anchor, and the
    leaf anchors no story reaches. A ref covers an anchor if it IS that anchor
    or a descendant of it (a leaf ref rolls up to its section; a section ref
    does NOT trickle down to mark every leaf covered)."""
    anchors = parse_sad_anchors()
    ids = {a["id"] for a in anchors}

    def covers(ref, aid):
        return ref == aid or ref.startswith(aid + ".")

    def is_leaf(aid):
        return not any(other != aid and other.startswith(aid + ".") for other in ids)

    rows = []
    for a in anchors:
        aid = a["id"]
        rows.append({
            **a,
            "section": aid.split(".")[0],
            "leaf": is_leaf(aid),
            "story_ids": [s["id"] for s in stories
                          if any(covers(r, aid) for r in s["sad_refs"])],
            "feature_refs": sum(1 for f in features
                                if any(covers(r, aid) for r in f["sad_refs"])),
            "epic_refs": sum(1 for e in epics
                             if any(covers(r, aid) for r in e["sad_refs"])),
        })

    # sad_refs used by stories that match no anchor on disk (typo / removed).
    dangling = {}
    for s in stories:
        for r in s["sad_refs"]:
            if r not in ids and not any(r.startswith(i + ".") or i.startswith(r + ".")
                                        for i in ids):
                dangling.setdefault(r, []).append(s["id"])
    dangling_refs = [{"ref": r, "story_ids": sids} for r, sids in sorted(dangling.items())]

    leaves = [r for r in rows if r["leaf"]]
    covered = sum(1 for r in leaves if r["story_ids"])
    return {
        "anchors": rows,
        "dangling_refs": dangling_refs,
        "leaf_total": len(leaves),
        "leaf_covered": covered,
    }


def build_board_model():
    """The full data model the static site renders, as plain dicts."""
    stories = _full_stories()

    epics = []
    for fm in all_epics():
        _, body = read_backlog_file(fm["_path"])
        epics.append({
            "id": fm.get("id", "?"),
            "title": _item_title(fm, body),
            "sad": _sentinel(fm.get("sad")),
            "parent": _sentinel(fm.get("parent")),
            "capabilities": parse_list(fm.get("capabilities")),
            "sad_refs": parse_sad_refs(fm.get("sad_refs")),
        })

    features = []
    for fm in all_features():
        _, body = read_backlog_file(fm["_path"])
        features.append({
            "id": fm.get("id", "?"),
            "title": _item_title(fm, body),
            "parent": _sentinel(fm.get("parent")),
            "capabilities": parse_list(fm.get("capabilities")),
            "sad_refs": parse_sad_refs(fm.get("sad_refs")),
        })

    fm_b, _ = active_batch()
    ip = sum(1 for s in stories if s["column"] == "in-progress")
    limit = batch_wip_limit()
    batch = None
    if fm_b:
        batch = {
            "id": fm_b.get("id", "?"),
            "capabilities": parse_list(fm_b.get("capabilities")),
            "goal": _sentinel(fm_b.get("goal")),
        }

    blocked = []
    for s in stories:
        if s["column"] == "blocked":
            reason = s["blocked_reason"] or "unspecified"
            blocked.append({
                "id": s["id"],
                "reason": reason,
                "kind": "decision" if DECISION_SIGNAL.search(reason) else "process",
                "prev_column": s["prev_column"],
            })

    # Retro chip (STEP 2): the retro of the most-recently-closed sprint, with its
    # count of still-open proposals — the retro→Vision gate handoff surface.
    retro = None
    lc_fm, _ = latest_closed_batch()
    if lc_fm:
        rs = [(rf, rb) for rf, rb in all_retros()
              if (rf.get("batch") or "").strip() == lc_fm.get("id")]
        if rs:
            rfm, rbody = rs[-1]
            retro = {
                "id": rfm.get("id", "?"),
                "batch": lc_fm.get("id", "?"),
                "open": sum(1 for c in proposal_rows(rbody)
                            if len(c) > 3 and c[3] == "proposed"),
            }

    # Idea inbox (#16): the firewalled return-edge, surfaced as its own tab so the
    # PO lens / triage loop can read provenance + staleness from the static site.
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date()
    ideas = []
    for fm in all_ideas():
        days = idea_age_days(fm, today)
        status = (fm.get("status") or "inbox").strip()
        ideas.append({
            "id": fm.get("id", "?"),
            "title": _item_title(fm, read_backlog_file(fm["_path"])[1]),
            "status": status,
            "age_days": days,
            "stale": days is not None and days >= STALE_IDEA_DAYS and status == "inbox",
            "born_from": _sentinel(fm.get("born_from")),
            "found_by": _sentinel(fm.get("found_by")),
            "discovery_type": _sentinel(fm.get("discovery_type")),
            "why": _sentinel(fm.get("why")),
        })

    return {
        "columns": COLUMNS,
        "stories": stories,
        "epics": epics,
        "features": features,
        "wip": {"in_progress": ip, "limit": limit, "over": ip > limit},
        "batch": batch,
        "retro": retro,
        "blocked": blocked,
        "ideas": ideas,
        "sad_coverage": build_sad_coverage(stories, features, epics),
    }


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backlog — Kanban &amp; Traceability</title>
<style>
:root{
  --bg:#0f1419; --panel:#171c24; --panel2:#1d232d; --line:#2a323d;
  --ink:#e6edf3; --muted:#8b97a6; --accent:#5aa6ff;
  --todo:#6b7785; --prog:#d6a740; --review:#9b7bd6; --done:#3fb37f; --blocked:#e0625e;
}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--ink)}
header{padding:18px 24px 0;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0 0 4px}
.sub{color:var(--muted);font-size:12px;margin-bottom:14px}
.tabs{display:flex;gap:4px}
.tab{padding:9px 16px;cursor:pointer;border:none;background:none;color:var(--muted);
  font-size:13px;font-weight:600;border-bottom:2px solid transparent}
.tab.active{color:var(--ink);border-bottom-color:var(--accent)}
main{padding:18px 24px 60px}
.banner{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}
.chip{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font-size:12px}
.chip b{color:var(--ink)}
.chip.warn{border-color:var(--blocked);color:#ffb4b1}
.chip.cap{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--accent);padding:2px 7px}
.cols{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;align-items:start}
.col{background:var(--panel);border:1px solid var(--line);border-radius:10px;min-height:60px}
.col-h{padding:10px 12px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em;
  border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
.col-h .n{color:var(--muted);font-weight:600}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.cards{padding:10px;display:flex;flex-direction:column;gap:9px}
.card{background:var(--panel2);border:1px solid var(--line);border-left:3px solid var(--line);
  border-radius:7px;padding:9px 10px;cursor:pointer;transition:border-color .12s}
.card:hover{border-color:var(--accent)}
.card .cid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--accent)}
.card .ct{margin-top:3px;font-size:12.5px;color:var(--ink)}
.card .meta{margin-top:7px;display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.tag{font-size:10px;padding:1px 6px;border-radius:4px;background:#222c38;color:var(--muted);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.tag.sad{color:#cda6ff;background:#2a2440}
.prog{margin-top:7px;height:4px;background:#222c38;border-radius:3px;overflow:hidden}
.prog>i{display:block;height:100%;background:var(--done)}
.prog-t{font-size:10px;color:var(--muted);margin-top:3px}
/* traceability */
.tree{display:flex;flex-direction:column;gap:12px;max-width:1100px}
.epic{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.epic-h{padding:12px 14px;background:var(--panel2);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.epic-h .eid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);font-weight:700}
.epic-h .et{font-weight:600}
.feat{border-top:1px solid var(--line);padding:10px 14px 10px 22px}
.feat-h{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:7px}
.feat-h .fid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#7fd6a8;font-weight:600}
.srow{display:flex;gap:9px;align-items:center;padding:4px 0 4px 14px;border-left:2px solid var(--line);
  margin-left:6px;flex-wrap:wrap}
.srow .sid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--accent)}
.srow .st{font-size:12.5px;color:var(--muted);flex:1;min-width:160px}
.pill{font-size:10px;padding:1px 8px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.muted{color:var(--muted)}
.empty{color:var(--muted);font-style:italic;padding:8px 0}
/* sad coverage */
.cov{max-width:1000px}
.cov-sec{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:12px;overflow:hidden}
.cov-sec-h{padding:11px 14px;background:var(--panel2);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.cov-sec-h .aid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cda6ff;font-weight:700}
.bar{height:6px;width:120px;background:#222c38;border-radius:3px;overflow:hidden;margin-left:auto}
.bar>i{display:block;height:100%;background:var(--done)}
.arow{display:flex;gap:10px;align-items:center;padding:7px 14px 7px 24px;border-top:1px solid var(--line);flex-wrap:wrap}
.arow .aid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#cda6ff;min-width:78px}
.arow .at{font-size:12.5px;flex:1;min-width:160px;color:var(--muted)}
.arow.uncov{background:#2a1d1d}
.arow.uncov .at{color:#ffb4b1}
.badge{font-size:10px;padding:1px 7px;border-radius:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}
.badge.ok{background:#163a2a;color:#5fd39c}
.badge.no{background:#3a1d1d;color:#ff8d88}
.sref{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--accent);
  background:#1d2530;border:1px solid var(--line);border-radius:4px;padding:1px 6px;cursor:pointer}
/* modal */
.ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:flex-start;
  justify-content:center;padding:60px 16px;z-index:10}
.ov.show{display:flex}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:12px;max-width:640px;width:100%;
  padding:20px 22px;max-height:80vh;overflow:auto}
.modal h2{margin:0 0 2px;font-size:15px}
.modal .mid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);font-size:12px}
.modal ul{margin:10px 0 0;padding-left:18px}
.modal li{margin:3px 0}
.modal li.done{color:var(--muted);text-decoration:line-through}
.x{float:right;cursor:pointer;color:var(--muted);font-size:20px;line-height:1;border:none;background:none}
.legend{display:flex;gap:14px;font-size:11px;color:var(--muted);margin:0 0 14px}
.legend span{display:flex;align-items:center}
@media(max-width:960px){.cols{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<header>
  <h1>Backlog</h1>
  <div class="sub">Kanban &amp; traceability — generated snapshot. The <code>backlog/</code> folder is the source of truth.</div>
  <div class="tabs">
    <button class="tab active" data-tab="board">Kanban board</button>
    <button class="tab" data-tab="trace">Traceability</button>
    <button class="tab" data-tab="cover">SAD coverage</button>
    <button class="tab" data-tab="inbox">Idea inbox</button>
  </div>
</header>
<main>
  <section id="board"></section>
  <section id="trace" style="display:none"></section>
  <section id="cover" style="display:none"></section>
  <section id="inbox" style="display:none"></section>
</main>
<div class="ov" id="ov"><div class="modal" id="modal"></div></div>
<script>
const DATA = __DATA__;
const COLW = {todo:'var(--todo)','in-progress':'var(--prog)',review:'var(--review)',done:'var(--done)',blocked:'var(--blocked)'};
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const byId = {}; DATA.stories.forEach(s=>byId[s.id]=s);

function tags(s){
  let t='';
  if(s.capability) t+=`<span class="tag">${esc(s.capability)}</span>`;
  s.sad_refs.forEach(r=>t+=`<span class="tag sad">${esc(r)}</span>`);
  return t;
}
function progress(s){
  if(!s.criteria_total) return '';
  const pct=Math.round(100*s.criteria_done/s.criteria_total);
  return `<div class="prog"><i style="width:${pct}%"></i></div>
    <div class="prog-t">${s.criteria_done}/${s.criteria_total} criteria</div>`;
}
function card(s){
  return `<div class="card" style="border-left-color:${COLW[s.column]}" onclick="open_('${s.id}')">
    <div class="cid">${esc(s.id)}</div>
    <div class="ct">${esc(s.title)}</div>
    <div class="meta">${tags(s)}</div>
    ${s.column==='blocked' && s.blocked_reason ? `<div class="prog-t">⚠ ${esc(s.blocked_reason)}</div>`:progress(s)}
  </div>`;
}
function renderBoard(){
  const w=DATA.wip, parts=[];
  let banner='<div class="banner">';
  banner+=`<div class="chip ${w.over?'warn':''}"><b>WIP</b> ${w.in_progress}/${w.limit}${w.over?' ⚠ over limit':''}</div>`;
  if(DATA.batch){
    banner+=`<div class="chip"><b>Batch</b> ${esc(DATA.batch.id)}`;
    DATA.batch.capabilities.forEach(c=>banner+=` <span class="chip cap">${esc(c)}</span>`);
    banner+='</div>';
  } else banner+='<div class="chip"><b>Batch</b> none (Commit gate open)</div>';
  if(DATA.retro){
    banner+=`<div class="chip"><b>Retro</b> ${esc(DATA.retro.id)} (${esc(DATA.retro.batch)}) · ${DATA.retro.open} open</div>`;
  }
  if(DATA.ideas&&DATA.ideas.length){
    const staleN=DATA.ideas.filter(i=>i.stale).length;
    banner+=`<div class="chip ${staleN?'warn':''}"><b>Inbox</b> ${DATA.ideas.length} idea(s)${staleN?' · '+staleN+' stale':''} <span class="muted">(firewalled)</span></div>`;
  }
  DATA.blocked.forEach(b=>banner+=`<div class="chip warn"><b>${esc(b.id)}</b> ${b.kind==='decision'?'🔶':''} ${esc(b.reason)}</div>`);
  banner+='</div>';
  parts.push(banner);

  let cols='<div class="cols">';
  DATA.columns.forEach(col=>{
    const items=DATA.stories.filter(s=>s.column===col);
    cols+=`<div class="col"><div class="col-h"><span><span class="dot" style="background:${COLW[col]}"></span>${esc(col.replace('-',' '))}</span><span class="n">${items.length}</span></div>
      <div class="cards">${items.map(card).join('')||'<div class="empty">—</div>'}</div></div>`;
  });
  cols+='</div>';
  parts.push(cols);
  document.getElementById('board').innerHTML=parts.join('');
}
function srow(s){
  return `<div class="srow"><span class="pill" style="background:${COLW[s.column]}33;color:${COLW[s.column]}">${esc(s.column)}</span>
    <span class="sid" style="cursor:pointer" onclick="open_('${s.id}')">${esc(s.id)}</span>
    <span class="st">${esc(s.title)}</span>${tags(s)}</div>`;
}
function renderTrace(){
  const feats=DATA.features, stories=DATA.stories;
  let html=`<div class="legend">
    <span><span class="dot" style="background:var(--todo)"></span>todo</span>
    <span><span class="dot" style="background:var(--prog)"></span>in-progress</span>
    <span><span class="dot" style="background:var(--review)"></span>review</span>
    <span><span class="dot" style="background:var(--done)"></span>done</span>
    <span><span class="dot" style="background:var(--blocked)"></span>blocked</span></div><div class="tree">`;
  const usedFeat=new Set(), usedStory=new Set();
  DATA.epics.forEach(e=>{
    html+=`<div class="epic"><div class="epic-h"><span class="eid">${esc(e.id)}</span><span class="et">${esc(e.title)}</span>`;
    if(e.sad) html+=`<span class="tag sad">${esc(e.sad)}</span>`;
    e.capabilities.forEach(c=>html+=`<span class="tag">${esc(c)}</span>`);
    html+='</div>';
    const efs=feats.filter(f=>f.parent===e.id);
    if(!efs.length) html+='<div class="feat"><span class="empty">no features</span></div>';
    efs.forEach(f=>{
      usedFeat.add(f.id);
      html+=`<div class="feat"><div class="feat-h"><span class="fid">${esc(f.id)}</span><span>${esc(f.title)}</span>`;
      f.sad_refs.forEach(r=>html+=`<span class="tag sad">${esc(r)}</span>`);
      html+='</div>';
      const fss=stories.filter(s=>s.parent===f.id);
      if(!fss.length) html+='<div class="empty" style="padding-left:14px">no stories</div>';
      fss.forEach(s=>{usedStory.add(s.id);html+=srow(s);});
      html+='</div>';
    });
    html+='</div>';
  });
  const orphanF=feats.filter(f=>!usedFeat.has(f.id));
  const orphanS=stories.filter(s=>!usedStory.has(s.id));
  if(orphanF.length||orphanS.length){
    html+=`<div class="epic"><div class="epic-h"><span class="eid">unparented</span><span class="muted">features/stories with no matching parent</span></div>`;
    orphanF.forEach(f=>{html+=`<div class="feat"><div class="feat-h"><span class="fid">${esc(f.id)}</span><span>${esc(f.title)} <span class="muted">(parent ${esc(f.parent||'—')})</span></span></div>`;
      stories.filter(s=>s.parent===f.id).forEach(s=>{usedStory.add(s.id);html+=srow(s);});html+='</div>';});
    const stillOrphan=stories.filter(s=>!usedStory.has(s.id));
    if(stillOrphan.length){html+='<div class="feat">';stillOrphan.forEach(s=>html+=srow(s));html+='</div>';}
    html+='</div>';
  }
  html+='</div>';
  document.getElementById('trace').innerHTML=html;
}
function renderCover(){
  const cov=DATA.sad_coverage;
  if(!cov||!cov.anchors.length){
    document.getElementById('cover').innerHTML='<div class="empty">No SAD anchors found in backlog/sad/.</div>';
    return;
  }
  const pct=cov.leaf_total?Math.round(100*cov.leaf_covered/cov.leaf_total):0;
  const uncov=cov.leaf_total-cov.leaf_covered;
  let html=`<div class="banner">
    <div class="chip"><b>Leaf coverage</b> ${cov.leaf_covered}/${cov.leaf_total} (${pct}%)</div>
    <div class="chip ${uncov?'warn':''}"><b>Uncovered</b> ${uncov}</div>
    <div class="chip ${cov.dangling_refs.length?'warn':''}"><b>Dangling refs</b> ${cov.dangling_refs.length}</div>
  </div><div class="cov">`;

  // group anchors by top-level section, preserving file order
  const order=[], groups={};
  cov.anchors.forEach(a=>{if(!groups[a.section]){groups[a.section]=[];order.push(a.section)}groups[a.section].push(a);});
  order.forEach(sec=>{
    const items=groups[sec];
    const header=items.find(a=>a.id===sec);
    const leaves=items.filter(a=>a.leaf);
    const done=leaves.filter(a=>a.story_ids.length).length;
    const p=leaves.length?Math.round(100*done/leaves.length):100;
    html+=`<div class="cov-sec"><div class="cov-sec-h"><span class="aid">${esc(sec)}</span>
      <span>${esc(header?header.title:'')}</span>
      <span class="muted" style="font-size:11px">${done}/${leaves.length} leaves</span>
      <div class="bar"><i style="width:${p}%"></i></div></div>`;
    items.forEach(a=>{
      if(a.id===sec && a.level<=2 && leaves.length) return; // section header already shown
      const covered=a.story_ids.length>0;
      html+=`<div class="arow ${a.leaf&&!covered?'uncov':''}">
        <span class="aid">${esc(a.id)}</span>
        <span class="at">${esc(a.title)}</span>`;
      if(a.story_ids.length){
        html+=a.story_ids.map(id=>`<span class="sref" onclick="open_('${id}')">${esc(id)}</span>`).join(' ');
      } else if(a.leaf){
        html+='<span class="badge no">uncovered</span>';
      } else {
        html+='<span class="muted" style="font-size:11px">section</span>';
      }
      if(a.feature_refs||a.epic_refs) html+=`<span class="muted" style="font-size:10px">${a.epic_refs?'E·'+a.epic_refs+' ':''}${a.feature_refs?'F·'+a.feature_refs:''}</span>`;
      html+='</div>';
    });
    html+='</div>';
  });
  if(cov.dangling_refs.length){
    html+=`<div class="cov-sec"><div class="cov-sec-h"><span class="aid" style="color:#ff8d88">dangling refs</span>
      <span class="muted">story sad_refs that match no anchor in backlog/sad/</span></div>`;
    cov.dangling_refs.forEach(d=>{
      html+=`<div class="arow uncov"><span class="aid">${esc(d.ref)}</span><span class="at">referenced by</span>
        ${d.story_ids.map(id=>`<span class="sref" onclick="open_('${id}')">${esc(id)}</span>`).join(' ')}</div>`;
    });
    html+='</div>';
  }
  html+='</div>';
  document.getElementById('cover').innerHTML=html;
}
function renderInbox(){
  const ideas=DATA.ideas||[];
  let html=`<div class="banner">
    <div class="chip"><b>Inbox</b> ${ideas.length} idea(s)</div>
    <div class="chip ${ideas.filter(i=>i.stale).length?'warn':''}"><b>Stale</b> ${ideas.filter(i=>i.stale).length}</div>
    <div class="chip"><span class="muted">capture≠commit · firewalled from the build loop · Vision gate promotes</span></div>
  </div>`;
  if(!ideas.length){
    html+='<div class="empty">Idea inbox is empty. Capture an out-of-scope discovery with <code>board.py idea-new</code> or <code>/capture-idea</code>.</div>';
    document.getElementById('inbox').innerHTML=html;
    return;
  }
  html+='<div class="tree">';
  ideas.forEach(i=>{
    const age=i.age_days==null?'?':i.age_days+'d';
    html+=`<div class="epic"><div class="epic-h">
      <span class="eid">${esc(i.id)}</span><span class="et">${esc(i.title)}</span>
      <span class="tag">${esc(i.status)}</span>
      <span class="tag">age ${esc(age)}</span>
      ${i.stale?'<span class="badge no">stale</span>':''}
      ${i.discovery_type?`<span class="tag">${esc(i.discovery_type)}</span>`:''}</div>
      <div class="feat">
        ${i.born_from?`<div class="prog-t">born_from: <span class="sref">${esc(i.born_from)}</span></div>`:''}
        ${i.found_by?`<div class="prog-t">found_by: ${esc(i.found_by)}</div>`:''}
        ${i.why?`<div class="prog-t" style="margin-top:4px">why: ${esc(i.why)}</div>`:''}
      </div></div>`;
  });
  html+='</div>';
  document.getElementById('inbox').innerHTML=html;
}
function open_(id){
  const s=byId[id]; if(!s) return;
  let h=`<button class="x" onclick="close_()">×</button>
    <div class="mid">${esc(s.id)} · ${esc(s.column)}${s.capability?' · '+esc(s.capability):''}</div>
    <h2>${esc(s.title)}</h2>`;
  if(s.sad_refs.length) h+=`<div class="meta" style="margin-top:8px">${s.sad_refs.map(r=>`<span class="tag sad">${esc(r)}</span>`).join('')}</div>`;
  if(s.blocked_reason) h+=`<div class="chip warn" style="margin-top:10px">⚠ ${esc(s.blocked_reason)} (from ${esc(s.prev_column||'?')})</div>`;
  if(s.criteria.length){
    h+=`<div style="margin-top:12px;font-weight:600;font-size:12px">Acceptance criteria (${s.criteria_done}/${s.criteria_total})</div><ul>`;
    s.criteria.forEach(c=>h+=`<li class="${c.done?'done':''}">${c.done?'✓ ':'☐ '}${esc(c.text)}</li>`);
    h+='</ul>';
  }
  document.getElementById('modal').innerHTML=h;
  document.getElementById('ov').classList.add('show');
}
function close_(){document.getElementById('ov').classList.remove('show');}
document.getElementById('ov').onclick=e=>{if(e.target.id==='ov')close_();};
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  const tab=t.dataset.tab;
  document.getElementById('board').style.display=tab==='board'?'':'none';
  document.getElementById('trace').style.display=tab==='trace'?'':'none';
  document.getElementById('cover').style.display=tab==='cover'?'':'none';
  document.getElementById('inbox').style.display=tab==='inbox'?'':'none';
});
renderBoard(); renderTrace(); renderCover(); renderInbox();
</script>
</body>
</html>
"""


def html_staleness():
    """Return a nudge string if backlog/index.html is missing or older than the
    newest backlog source file, else ''. Pure read — never regenerates."""
    out = os.path.join(ROOT, "backlog", "index.html")
    if not os.path.exists(out):
        return "backlog/index.html not generated — run `board.py render-html`"
    html_mtime = os.path.getmtime(out)
    newest = 0.0
    for sub in ("board", "epics", "features", "sad", "batches"):
        for p in glob.glob(os.path.join(ROOT, "backlog", sub, "**", "*.md"),
                           recursive=True):
            newest = max(newest, os.path.getmtime(p))
    if newest > html_mtime:
        return "backlog/index.html is stale — re-run `board.py render-html`"
    return ""


def cmd_render_html(args):
    model = build_board_model()
    data_json = json.dumps(model, ensure_ascii=False, separators=(",", ":"))
    html = HTML_TEMPLATE.replace("__DATA__", data_json)
    out = os.path.join(ROOT, "backlog", "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    n = len(model["stories"])
    print(f"wrote {out} ({n} stories, {len(model['epics'])} epics, "
          f"{len(model['features'])} features)")


def cmd_validate(args):
    problems = []
    warnings = []  # surfaced but non-blocking (e.g. Draft SAD, stale ## Status)
    stories = all_stories()
    ids_seen = {}
    story_caps = set()
    sad_files = list_sad_files()
    sad_id = getattr(args, "sad", None)
    # Multi-SAD aware: each story is validated against the SAD that governs it
    # (resolved via feature → epic → sad), so several SADs can coexist and a
    # bare `validate` checks every story against its own contract. `--sad` still
    # scopes the coverage report (and Draft-status warning) to one SAD.
    if sad_id and not os.path.exists(sad_file_path(sad_id)):
        problems.append(f"{sad_id}: SAD file not found in backlog/sad/")

    # Commit gate + WIP (#6, #7): at most one active batch, and in-progress within cap.
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
            f"— close the others (the Commit gate is a single commitment)"
        )
    ip = column_count("in-progress")
    limit = batch_wip_limit()
    if ip > limit:
        problems.append(
            f"WIP breach: {ip} stories in-progress (limit {limit}) — finish or "
            f"defer one, or raise the active batch's wip_limit (Commit gate)"
        )

    # Retrospectives (STEP 2): each retro must point at a real batch, carry valid
    # proposal statuses, and never leave an accepted proposal dangling (no IDEA).
    batch_ids = {fm.get("id") for fm, _ in batches}
    retros_per_batch = {}
    for rfm, rbody in all_retros():
        rid = rfm.get("id", "?")
        if not RETRO_ID.match(rid):
            problems.append(f"{rid}: invalid retro id format (use RETRO-NNN)")
        if not id_matches_filename(rid, rfm["_path"]):
            problems.append(f"{rid}: frontmatter id does not match filename")
        rbatch = (rfm.get("batch") or "").strip()
        if rbatch not in batch_ids:
            problems.append(f"{rid}: batch {rbatch or '(unset)'} does not resolve "
                            f"to a real batch")
        retros_per_batch.setdefault(rbatch, []).append(rid)
        for cells in proposal_rows(rbody):
            pid = cells[0]
            status = cells[3] if len(cells) > 3 else ""
            result = cells[4] if len(cells) > 4 else ""
            if status not in ("proposed", "accepted", "rejected"):
                problems.append(f"{rid} {pid}: status '{status}' not in "
                                f"proposed/accepted/rejected")
            if status == "accepted" and (not result or result in SENTINELS
                                         or result in ("—", "-")):
                problems.append(f"{rid} {pid}: accepted but result is empty "
                                f"(dangling — no resulting IDEA/STORY)")
    for rbatch, rids in retros_per_batch.items():
        if len(rids) > 1:
            warnings.append(f"batch {rbatch} has {len(rids)} retros "
                            f"({', '.join(rids)}) — expected one")

    # Sprint commitment (Commit gate): the active sprint's committed stories must be
    # real & traceable, and its preparation work must respect capture≠commit —
    # forward-groundwork ideas may NOT already sit on the board, or they have
    # smuggled into the build loop the firewall exists to keep them out of.
    afm, abody = active_batch()
    if afm:
        abid = afm.get("id", "?")
        acaps = batch_capabilities(afm)
        committed = committed_stories(afm)
        for sid in committed:
            sp = find_story(sid)
            if not sp:
                problems.append(f"{abid}: committed story {sid} not found on the board")
                continue
            sfm, _ = read_story(sp)
            scap = (sfm.get("capability") or "").strip()
            if scap and scap not in SENTINELS and acaps and scap not in acaps:
                warnings.append(f"{abid}: committed {sid} has capability {scap} "
                                f"outside the sprint's committed {acaps}")
        for kind, pid, _why in parse_prep(abody):
            if pid.startswith("<"):
                continue  # unfilled template placeholder
            if kind == "story":
                if pid not in committed:
                    problems.append(f"{abid}: prep story {pid} is not in the committed "
                                    f"stories list — commit it or make it an idea")
            elif kind == "idea":
                if find_story(pid) is not None:
                    problems.append(f"{abid}: prep idea {pid} has a board file — "
                                    f"groundwork must stay firewalled (capture≠commit)")
                elif not os.path.exists(os.path.join(IDEAS, f"{pid}.md")):
                    warnings.append(f"{abid}: prep idea {pid} has no file in "
                                    f"backlog/ideas/ (inbox not populated yet)")

    # Stale-idea nudge (A5): inbox ideas past the archival horizon are noise.
    # Non-blocking — a warning that points at `idea-archive`, never a gate.
    from datetime import datetime, timezone
    _today = datetime.now(timezone.utc).date()
    for fm in all_ideas():
        if (fm.get("status") or "").strip() != "inbox":
            continue
        age = idea_age_days(fm, _today)
        if age is not None and age >= STALE_IDEA_DAYS:
            warnings.append(f"{fm.get('id','?')}: inbox idea is {age}d old "
                            f"(>{STALE_IDEA_DAYS}d) — run `board.py idea-archive`")

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
        # Idea firewall (#16/A4): the legal chain is story→feature→epic→SAD; a
        # story may never parent directly on an IDEA — that would smuggle inbox
        # groundwork into the build loop (capture≠commit). Make it a failure,
        # not a convention.
        if IDEA_ID.match(parent):
            problems.append(f"{sid}: parent {parent} is an IDEA — ideas are "
                            f"firewalled from the build loop (Vision gate promotes them)")
        elif parent and parent not in SENTINELS and parent != "FEAT-000":
            if FEAT_ID.match(parent) and not feature_exists(parent):
                problems.append(f"{sid}: orphan story — parent {parent} not found")

        if col == "blocked" and not prev_column_valid(fm):
            problems.append(f"{sid}: blocked without prev_column (can't unblock cleanly)")

    # Stale `## Status` prose (F6/#12): the section was dropped — flag any that
    # creep back so the column stays the single source of truth, non-blocking.
    for fm in stories:
        _, sbody = read_story(fm["_path"])
        if has_status_section(sbody):
            warnings.append(f"{fm.get('id','?')}: has a stale `## Status` section "
                            f"(removed in Phase 4 — the column is the status)")

    deferred = deferred_capabilities()
    _sad_info = {}

    def sad_info(sid_):
        """(anchors, caps, oos_tokens, status) for a SAD id, or None. Cached."""
        if not sid_:
            return None
        if sid_ not in _sad_info:
            path = sad_file_path(sid_)
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    txt = f.read()
                _sad_info[sid_] = (sad_anchors(txt), sad_capabilities(txt),
                                   sad_out_of_scope_tokens(txt), sad_status(txt))
            else:
                _sad_info[sid_] = None
        return _sad_info[sid_]

    # Per-story checks against the story's OWN governing SAD (resolved via the
    # feature → epic → sad chain; falls back to the explicit --sad SAD when the
    # chain can't be resolved). Capabilities found are tallied per SAD so the
    # coverage check below counts only stories that belong to that contract.
    covered_by_sad = {}
    for fm in stories:
        ssid = story_sad_id(fm) or sad_id
        info = sad_info(ssid)
        if not info:
            continue
        anchors, caps, oos_tokens, _status = info
        sid = fm.get("id", "?")
        for ref in parse_sad_refs(fm.get("sad_refs")):
            if ref not in anchors:
                problems.append(f"{sid}: dangling sad_ref {ref}")
        cap = (fm.get("capability") or "").strip()
        if cap and cap not in SENTINELS:
            if caps and cap not in caps:
                problems.append(f"{sid}: unknown capability {cap}")
            else:
                covered_by_sad.setdefault(ssid, set()).add(cap)
        # SAD#1.2 out-of-scope guard (#10): a story may not aim its Touch
        # scope at an artifact its SAD explicitly excludes.
        if oos_tokens:
            _, sbody = read_story(fm["_path"])
            for g in touch_scope(sbody):
                segs = set(re.split(r"[/*]+", g)) | {g}
                hit = oos_tokens & {s for s in segs if s}
                if hit:
                    problems.append(f"{sid}: Touch scope targets out-of-scope "
                                    f"(SAD#1.2) artifact {', '.join(sorted(hit))}")

    # Coverage (#10) + Draft-status warning, run per target SAD: the explicit
    # --sad one, else every SAD on disk.
    target_sads = ([sad_id] if sad_id
                   else [os.path.splitext(os.path.basename(p))[0] for p in sad_files])
    for tsid in target_sads:
        info = sad_info(tsid)
        if not info:
            continue
        anchors, caps, _oos, status = info
        # Architecture gate (#10): a non-Approved SAD is decomposed/built at your own risk.
        # Surfaced as a warning, not a hard block, so continuous validate stays
        # green while a Draft SAD is being worked.
        if status and status != "Approved":
            warnings.append(f"governing SAD {tsid} is '{status}', not Approved "
                            f"(Architecture gate: architecture not signed off)")
        covered = covered_by_sad.get(tsid, set())
        if stories and caps:
            for cap in sorted(caps):
                if cap in covered:
                    continue
                if cap in deferred:
                    warnings.append(f"capability {cap}: no story yet — deferred "
                                    f"({deferred[cap] or 'see deferred-capabilities.md'})")
                else:
                    problems.append(f"capability {cap}: no story coverage")
    # Batch capabilities are validated against EVERY SAD on disk — a batch may
    # commit work spanning more than one contract, so scoping to --sad here
    # would wrongly flag the others.
    all_caps = set()
    for p in sad_files:
        info = sad_info(os.path.splitext(os.path.basename(p))[0])
        if info:
            all_caps |= info[1]
    for fm, _ in actives:
        bid = fm.get("id", "?")
        for cap in batch_capabilities(fm):
            if all_caps and cap not in all_caps:
                problems.append(f"{bid}: unknown capability {cap} (not a SAD#3 cap)")

    stale = html_staleness()
    if stale:
        warnings.append(stale)

    if warnings:
        print("WARNINGS (non-blocking):")
        for w in warnings:
            print("  ! " + w)
    if problems:
        print("INVARIANT VIOLATIONS:")
        for p in problems:
            print("  - " + p)
        _log("validate", outcome="refused", message=f"{len(problems)} violations",
             count=len(problems), warnings=len(warnings))
        sys.exit(1)
    print("ok: no invariant violations"
          + (f" ({len(warnings)} warning(s))" if warnings else ""))
    _log("validate", message="no violations", warnings=len(warnings))


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


def code_review_problem(story_id, base, head):
    """R-1: require a fresh, clean code-reviewer artifact for review/done.

    Returns a problem string, or '' if the gate is satisfied. The artifact is
    pinned to BOTH ends of the diff (base + head): a bounced story keeps its
    base_commit but gains commits, so head moves and the stale review is
    rejected -- forcing rework to be re-reviewed.
    """
    p = os.path.join(workflow_log.log_dir(), f"review-{story_id}.json")
    if not os.path.exists(p):
        return (f"no code-review artifact; spawn the code-reviewer subagent, then "
                f"`board.py review-record {story_id}`")
    try:
        with open(p, encoding="utf-8") as f:
            doc = json.load(f)
    except Exception:
        return f"code-review artifact unreadable: {p}"
    if doc.get("base") != base or doc.get("head") != head:
        return ("code-review is stale (reviewed base/head != current diff); "
                "re-run the code-reviewer on the latest commit")
    if doc.get("verdict") != "clean" or doc.get("blocking"):
        return (f"code-review verdict '{doc.get('verdict')}' with "
                f"{len(doc.get('blocking', []))} blocking finding(s)")
    return ""


def cmd_review_record(args):
    """Ingest code-reviewer findings as a gateable artifact (.workflow/review-<id>.json).

    board.py stamps the authoritative base/head from the live story, so the
    artifact cannot claim freshness it does not have. This keeps board.py the
    only sanctioned writer of gate state.
    """
    from datetime import datetime, timezone
    path = find_story(args.id)
    if not path:
        _fatal(f"error: {args.id} not found", event="review-record", story_id=args.id)
    fm, _body = read_story(path)
    base = base_commit_of(fm)
    if not base:
        sys.exit(f"refused: {args.id} has no base_commit; run `move {args.id} in-progress` first")
    head = _git_run(["git", "rev-parse", "HEAD"]).strip()
    if not head:
        sys.exit("refused: could not resolve HEAD")
    raw = open(args.from_, encoding="utf-8").read() if args.from_ else sys.stdin.read()
    try:
        doc = json.loads(raw)
    except Exception as e:
        sys.exit(f"refused: findings not valid JSON: {e}")
    verdict = (doc.get("verdict") or "").strip()
    if verdict not in ("clean", "blocking", "cannot-review"):
        sys.exit("refused: verdict must be clean|blocking|cannot-review")
    record = {
        "story": args.id, "base": base, "head": head, "verdict": verdict,
        "blocking": doc.get("blocking", []), "out_of_scope": doc.get("out_of_scope", []),
        "reviewer": doc.get("reviewer", "code-reviewer"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    os.makedirs(workflow_log.log_dir(), exist_ok=True)
    out = os.path.join(workflow_log.log_dir(), f"review-{args.id}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    _log("review-record", story_id=args.id, base=base, verdict=verdict,
         count=len(record["blocking"]))
    print(f"recorded code-review for {args.id}: {verdict} "
          f"({len(record['blocking'])} blocking)")


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


# Below this wall-clock span a done story's whole todo→done march reads as a
# demo-sweep / as-built capture rather than a real build loop (F7).
INSTANT_SECONDS = 30


def _parse_ts(value):
    from datetime import datetime
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _median(values):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def _percentile(values, pct):
    if not values:
        return None
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((pct / 100) * (len(s) - 1)))))
    return s[k]


def _fmt_dur(seconds):
    if seconds is None:
        return "—"
    seconds = int(seconds)
    if seconds < 90:
        return f"{seconds}s"
    mins = seconds // 60
    if mins < 90:
        return f"{mins}m"
    hours = mins / 60
    if hours < 48:
        return f"{hours:.1f}h"
    return f"{hours / 24:.1f}d"


def _in_window(ts_value, window):
    """True if an event ts (ISO string) falls within an optional (start, end)."""
    if not window:
        return True
    start, end = window
    t = _parse_ts(ts_value)
    if t is None:
        return False
    if start and t < start:
        return False
    if end and t > end:
        return False
    return True


def sprint_window(batch_fm):
    """(start, end) datetimes bounding a sprint: batch `created` 00:00 UTC →
    its `batch-close` event ts, or None (open-ended) if still active."""
    from datetime import datetime, timezone
    created = (batch_fm.get("created") or "").strip()
    start = None
    if created and created not in SENTINELS:
        try:
            d = datetime.fromisoformat(created)
            start = d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
        except ValueError:
            start = None
    bid = (batch_fm.get("id") or "").strip()
    end = None
    for e in workflow_log.read_events(tail=0, tool="board", event="batch-close"):
        if e.get("batch_id") == bid:
            t = _parse_ts(e.get("ts"))
            if t and (end is None or t > end):
                end = t
    return start, end


def _stories_done_in_window(window):
    """Story ids that reached `done` (an ok move→done) within the window."""
    done = set()
    for e in workflow_log.read_events(tail=0, tool="board", event="move"):
        if e.get("to") == "done" and e.get("outcome") == "ok" \
                and _in_window(e.get("ts"), window):
            sid = e.get("story_id")
            if sid:
                done.add(sid)
    return done


def compute_metrics(window=None):
    """Retrospective aggregates off the event log (#9) — the agile feedback loop.

    Cycle time, review-check refusal rate, bounce rate, attempts spread, blocked
    duration, and the demo-sweep (F7) flag for done stories that never really ran
    the loop. `window=(start, end)` scopes every event to a sprint (events outside
    [created, close] are excluded). Returns a plain dict (also drives --json)."""
    import collections
    events = workflow_log.read_events(tail=0)
    if window:
        events = [e for e in events if _in_window(e.get("ts"), window)]
    moves = [e for e in events if e.get("tool") == "board"
             and e.get("event") == "move" and e.get("outcome") == "ok"]
    by_story = collections.defaultdict(list)
    for e in moves:
        sid = e.get("story_id")
        ts = _parse_ts(e.get("ts"))
        if sid and ts:
            by_story[sid].append((ts, e.get("from"), e.get("to")))
    for sid in by_story:
        by_story[sid].sort(key=lambda r: r[0])

    cycles, instant = {}, {}
    blocked_time = {}
    for sid, seq in by_story.items():
        first_start = next((ts for ts, _f, t in seq if t == "in-progress"), None)
        done_ts = next((ts for ts, _f, t in reversed(seq) if t == "done"), None)
        if first_start and done_ts and done_ts >= first_start:
            secs = (done_ts - first_start).total_seconds()
            (instant if secs < INSTANT_SECONDS else cycles)[sid] = secs
        # blocked spans: pair each enter-blocked with the next leave-blocked
        enter = None
        for ts, _f, t in seq:
            if t == "blocked":
                enter = ts
            elif enter is not None:
                blocked_time[sid] = blocked_time.get(sid, 0) + (ts - enter).total_seconds()
                enter = None

    # review-check gate health (explicit runs + hard-gate move blocks)
    rc = [e for e in events if e.get("tool") == "board" and e.get("event") == "review-check"]
    rc_refused = sum(1 for e in rc if e.get("outcome") == "refused")
    rc_total = len(rc)
    gate_blocks = sum(
        1 for e in events
        if e.get("tool") == "board" and e.get("event") == "move"
        and e.get("outcome") == "refused"
        and str(e.get("message", "")).startswith("review-check")
    )

    # R-1 code-review gate health: refused moves (missing/stale/blocking artifact)
    # and human --skip-code-review overrides. Over-use of overrides is the smell.
    code_review_blocks = sum(
        1 for e in events
        if e.get("tool") == "board" and e.get("event") == "move"
        and e.get("outcome") == "refused"
        and str(e.get("message", "")).startswith("code-review gate")
    )
    code_review_overrides = sum(
        1 for e in events
        if e.get("tool") == "board" and e.get("event") == "move"
        and e.get("outcome") == "override"
        and str(e.get("message", "")).startswith("--skip-code-review")
    )

    # bounce rate: rejects + any review→in-progress demote, over stories that
    # ever reached review.
    rejects = sum(1 for e in events if e.get("tool") == "board" and e.get("event") == "reject")
    demotes = sum(1 for ts, f, t in
                  [(ts, f, t) for seq in by_story.values() for ts, f, t in seq]
                  if f == "review" and t == "in-progress")
    bounces = rejects + demotes
    reached_review = sum(1 for seq in by_story.values()
                         if any(t == "review" for _ts, _f, t in seq))

    attempts = collections.Counter()
    for fm in all_stories():
        try:
            attempts[int(fm.get("attempts", "0") or "0")] += 1
        except ValueError:
            attempts[0] += 1

    cyc_vals = list(cycles.values())
    return {
        "events_total": len(events),
        "done_count": sum(1 for fm in all_stories() if fm["_column"] == "done"),
        "cycle": {
            "n": len(cyc_vals),
            "median_s": _median(cyc_vals),
            "p90_s": _percentile(cyc_vals, 90),
            "max_s": max(cyc_vals) if cyc_vals else None,
            "max_story": max(cycles, key=cycles.get) if cycles else None,
        },
        "review_check": {"runs": rc_total, "refused": rc_refused,
                         "refusal_rate": (rc_refused / rc_total) if rc_total else None,
                         "hard_gate_blocks": gate_blocks},
        "code_review": {"gate_blocks": code_review_blocks,
                        "overrides": code_review_overrides},
        "bounce": {"bounces": bounces, "reached_review": reached_review,
                   "rate": (bounces / reached_review) if reached_review else None},
        "blocked": {"total_s": sum(blocked_time.values()),
                    "longest_story": max(blocked_time, key=blocked_time.get) if blocked_time else None,
                    "longest_s": max(blocked_time.values()) if blocked_time else None},
        "attempts": dict(sorted(attempts.items())),
        "demo_sweep": sorted(instant.keys()),
    }


def _resolve_window(args):
    """Resolve a metrics window from --sprint / --since / --until, or None."""
    from datetime import datetime, timezone
    sprint = getattr(args, "sprint", None)
    if sprint:
        fm, _ = find_batch(sprint)
        if not fm:
            _fatal(f"{sprint} not found in backlog/batches/", event="metrics")
        return sprint_window(fm)
    since, until = getattr(args, "since", None), getattr(args, "until", None)
    if since or until:
        def parse(d):
            if not d:
                return None
            dt = datetime.fromisoformat(d)
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        return (parse(since), parse(until))
    return None


def cmd_metrics(args):
    window = _resolve_window(args)
    m = compute_metrics(window)
    if args.json:
        print(json.dumps(m, indent=2))
        _log("metrics", count=m["done_count"])
        return
    c, rcheck, b, bl = m["cycle"], m["review_check"], m["bounce"], m["blocked"]
    scope = f" · scope {args.sprint}" if getattr(args, "sprint", None) else (
        " · windowed" if window else "")
    print(f"RETROSPECTIVE — {m['events_total']} logged events{scope}, "
          f"{m['done_count']} done\n")
    print(f"Cycle time (n={c['n']}, demo-sweep excluded):")
    print(f"  median {_fmt_dur(c['median_s'])} · p90 {_fmt_dur(c['p90_s'])} · "
          f"max {_fmt_dur(c['max_s'])}" + (f" ({c['max_story']})" if c['max_story'] else ""))
    rate = rcheck["refusal_rate"]
    print(f"\nReview-check gate: {rcheck['refused']}/{rcheck['runs']} runs refused"
          + (f" ({rate*100:.0f}%)" if rate is not None else "")
          + f" · {rcheck['hard_gate_blocks']} hard-gate move block(s)")
    crv = m["code_review"]
    print(f"Code-review gate (R-1): {crv['gate_blocks']} move block(s)"
          f" · {crv['overrides']} override(s)")
    brate = b["rate"]
    print(f"Bounce rate: {b['bounces']} bounce(s) across {b['reached_review']} "
          f"stories that reached review"
          + (f" ({brate*100:.0f}%)" if brate is not None else ""))
    print(f"Blocked time: {_fmt_dur(bl['total_s'])} total"
          + (f" · longest {bl['longest_story']} ({_fmt_dur(bl['longest_s'])})"
             if bl["longest_story"] else ""))
    if m["attempts"]:
        hist = " ".join(f"{k}×{v}" for k, v in m["attempts"].items())
        print(f"Attempts distribution (stories by attempt count): {hist}")
    if m["demo_sweep"]:
        print(f"\n⚠ demo-sweep / as-built (F7) — {len(m['demo_sweep'])} done "
              f"in <{INSTANT_SECONDS}s, no real loop:")
        print("    " + ", ".join(m["demo_sweep"]))
    _log("metrics", count=m["done_count"])


def _retro_snapshot(m):
    """A frozen, human-readable copy of the windowed metrics for the retro body."""
    c, rc, b, bl = m["cycle"], m["review_check"], m["bounce"], m["blocked"]
    rate = rc["refusal_rate"]
    return [
        f"- cycle: median {_fmt_dur(c['median_s'])} · p90 {_fmt_dur(c['p90_s'])} "
        f"(n={c['n']})",
        f"- review-check: {rc['refused']}/{rc['runs']} refused"
        + (f" ({rate*100:.0f}%)" if rate is not None else "")
        + f" · {rc['hard_gate_blocks']} hard-gate block(s)",
        f"- code-review gate (R-1): {m['code_review']['gate_blocks']} block(s) · "
        f"{m['code_review']['overrides']} override(s)",
        f"- bounce: {b['bounces']} / {b['reached_review']} reached-review"
        + (f" ({b['rate']*100:.0f}%)" if b["rate"] is not None else ""),
        f"- blocked: " + (f"{bl['longest_story']} {_fmt_dur(bl['longest_s'])} (longest)"
                          if bl["longest_story"] else "none"),
    ]


def _retro_body(committed, shipped, carried, unplanned, m):
    def fmt(ids):
        return ", ".join(ids) if ids else "—"
    lines = [
        "",
        "## Committed vs shipped",
        f"- committed: {fmt(committed)}  ({len(committed)})",
        f"- shipped:   {fmt(shipped)}  ({len(shipped)})",
        f"- carried:   {fmt(carried)}  (still open at close)",
        f"- unplanned: {fmt(unplanned)}  (shipped, not committed)",
        "",
        "## Metrics snapshot",
        *_retro_snapshot(m),
        "",
        "## Observations",
        "- <evidence-anchored friction, one bullet each — fill from the ceremony>",
        "",
        "## Workflow-change proposals",
        "<!-- Top 1–3 frictions as concrete changes to a NAMED artifact (gate/file/",
        "     tool). `board.py sprint-retro --accept P-N` flips status to accepted",
        "     AND spawns an IDEA (capture≠commit); `--reject P-N` flips to rejected. -->",
        "",
        "| id  | target (gate/file/tool) | type | status | result |",
        "|-----|-------------------------|------|--------|--------|",
        "",
    ]
    return "\n".join(lines)


def _retro_decide(args, accept, reject):
    """Flip one proposal's status in place; on accept, spawn the IDEA (Vision gate)."""
    retros = all_retros()
    if not retros:
        _fatal("no retro to update (run `sprint-retro` to scaffold one first)",
               event="sprint-retro")
    bid = getattr(args, "batch", None)
    if bid:
        match = [(fm, b) for fm, b in retros if (fm.get("batch") or "").strip() == bid]
        if not match:
            _fatal(f"no retro found for {bid}", event="sprint-retro")
        rfm, rbody = match[-1]
    else:
        rfm, rbody = retros[-1]
    rid = rfm.get("id", "?")
    pid = accept or reject
    lines = rbody.split("\n")
    spawned = None
    for i, line in enumerate(lines):
        cells = parse_proposal_row(line)
        if not cells or cells[0] != pid:
            continue
        while len(cells) < 5:
            cells.append("—")
        if accept:
            cells[3] = "accepted"
            spawned = _write_idea(title=f"Workflow change ({rid} {pid})",
                                  born_from=rid, found_by="retro",
                                  why=cells[1], discovery_type="out-of-scope")
            cells[4] = spawned
        else:
            cells[3] = "rejected"
        lines[i] = "| " + " | ".join(cells) + " |"
        break
    else:
        _fatal(f"{pid} not found in {rid}", event="sprint-retro")
    rfm.pop("_path", None)
    new_body = "\n".join(lines)
    if not new_body.endswith("\n"):
        new_body += "\n"
    with open(os.path.join(RETROS, f"{rid}.md"), "w", encoding="utf-8") as f:
        f.write(dump_fm(rfm, new_body))
    verb = "accepted" if accept else "rejected"
    print(f"{rid}: {pid} -> {verb}" + (f" (spawned {spawned} in the inbox)" if spawned else ""))
    _log("sprint-retro", message=f"{pid} {verb}", batch_id=(rfm.get("batch") or ""),
         **({"result": spawned} if spawned else {}))


def cmd_sprint_retro(args):
    """Sprint STEP 2 — author/extend a retrospective on a CLOSED sprint.

    No flags scaffold `RETRO-NNN` from the closing batch: a committed-vs-shipped
    delta + a frozen windowed metrics snapshot + an empty proposal table for the
    ceremony to fill. `--accept P-N` flips a proposal to accepted and spawns an
    IDEA (the accepted workflow change lands at the Vision gate, capture≠commit); `--reject
    P-N` flips it to rejected. Refuses to retro an ACTIVE sprint — close it first.
    """
    accept = getattr(args, "accept", None)
    reject = getattr(args, "reject", None)
    if accept and reject:
        _fatal("pass --accept OR --reject, not both", event="sprint-retro")
    if accept or reject:
        return _retro_decide(args, accept, reject)

    bid = getattr(args, "batch", None)
    if bid:
        fm, body = find_batch(bid)
        if not fm:
            _fatal(f"{bid} not found in backlog/batches/", event="sprint-retro")
    else:
        fm, body = latest_closed_batch()
        if not fm:
            _fatal("no closed sprint to retro — close one first "
                   "(board.py sprint-close <id>)", event="sprint-retro")
        bid = fm.get("id")
    if (fm.get("status") or "").strip() == "active":
        _fatal(f"{bid} is still active — close the sprint first "
               f"(board.py sprint-close {bid}), then retro", event="sprint-retro")

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    window = sprint_window(fm)
    start, end = window
    committed = committed_stories(fm)
    done_set = _stories_done_in_window(window)
    shipped = [s for s in committed if s in done_set]
    carried = [s for s in committed if s not in done_set]
    unplanned = sorted(done_set - set(committed))
    m = compute_metrics(window)

    rid = _next_item_id(RETROS, "RETRO")
    rfm = {
        "id": rid,
        "type": "retro",
        "batch": bid,
        "created": now.date().isoformat(),
        "window_start": start.date().isoformat() if start else "~",
        "window_end": end.isoformat() if end else now.isoformat(),
        "committed": str(len(committed)),
        "shipped": str(len(shipped)),
    }
    body_out = _retro_body(committed, shipped, carried, unplanned, m)
    os.makedirs(RETROS, exist_ok=True)
    out = os.path.join(RETROS, f"{rid}.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(dump_fm(rfm, body_out))
    if any((rf.get("batch") or "").strip() == bid for rf, _ in all_retros()
           if rf.get("id") != rid):
        print(f"note: {bid} already had a retro — {rid} is an additional one")
    print(f"created {rid} for {bid}: committed {len(committed)}, shipped "
          f"{len(shipped)} (carried {len(carried)}, unplanned {len(unplanned)})")
    print(f"  edit {os.path.relpath(out, ROOT)} — fill Observations + proposals, "
          f"then `sprint-retro --accept P-N` to land them at the Vision gate")
    _log("sprint-retro", message=rid, batch_id=bid,
         count=len(committed), shipped=len(shipped))


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
    m.add_argument("--skip-ready", action="store_true",
                   help="human override: start a story despite a failing "
                        "Definition of Ready (logged as an override)")
    m.add_argument("--skip-code-review", action="store_true",
                   help="human override: move to review/done despite a missing "
                        "or failing code-review artifact (logged as an override)")
    m.set_defaults(fn=cmd_move)

    l = sub.add_parser("list"); l.add_argument("--column"); l.add_argument("--capability")
    l.add_argument("--target"); l.add_argument("--json", action="store_true")
    l.set_defaults(fn=cmd_list)

    n = sub.add_parser("new"); n.add_argument("--capability", required=True)
    n.add_argument("--parent", required=True); n.add_argument("--id"); n.add_argument("--title")
    n.set_defaults(fn=cmd_new)

    for kind in ITEM_KINDS:
        ni = sub.add_parser(f"new-{kind}", help=f"scaffold a new {kind} (auto-numbered)")
        ni.add_argument("--parent", help="parent id (required for feature)")
        ni.add_argument("--id", help=f"explicit id (default: auto-numbered)")
        ni.add_argument("--title")
        ni.set_defaults(fn=cmd_new_item, kind=kind)

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

    bn = sub.add_parser("batch-new", help="Commit gate: commit a batch of capabilities")
    bn.add_argument("--capabilities", required=True, help="comma-separated CAP ids")
    bn.add_argument("--goal", help="one-line batch goal")
    bn.add_argument("--wip", type=int, help=f"in-progress WIP limit (default {DEFAULT_WIP_LIMIT})")
    bn.add_argument("--id", help="BATCH-NNN (default: auto-numbered)")
    bn.set_defaults(fn=cmd_batch_new)

    bc = sub.add_parser("batch-close", help="close a batch (Commit-gate commitment done)")
    bc.add_argument("id")
    bc.set_defaults(fn=cmd_batch_close)

    bl = sub.add_parser("batch-list", help="show batches + live WIP usage")
    bl.add_argument("--json", action="store_true")
    bl.set_defaults(fn=cmd_batch_list)

    # Sprint vocabulary (Commit gate): a sprint IS a batch + its planning/retro
    # ceremonies. `sprint-plan-new` is the human Commit-gate commit that ratifies the
    # plan the /sprint-plan agent team prepared.
    spn = sub.add_parser("sprint-plan-new",
                         help="Commit gate: commit a sprint plan (enriched batch)")
    spn.add_argument("--capabilities", required=True, help="comma-separated CAP ids")
    spn.add_argument("--goal", help="one-line falsifiable sprint goal (outcome, not a task list)")
    spn.add_argument("--stories", help="comma-separated STORY ids committed to the sprint")
    spn.add_argument("--prep", help="prep items: story:ID,idea:ID,note:text (comma-separated)")
    spn.add_argument("--exec-strategy", dest="exec_strategy",
                     help="how Claude Code agent teams run the work (parallel vs sequenced)")
    spn.add_argument("--wip", type=int, help=f"in-progress WIP limit (default {DEFAULT_WIP_LIMIT})")
    spn.add_argument("--id", help="BATCH-NNN (default: auto-numbered)")
    spn.set_defaults(fn=cmd_batch_new)

    stt = sub.add_parser("status",
                         help="where am I in the workflow + the next step")
    stt.add_argument("--json", action="store_true")
    stt.set_defaults(fn=cmd_status)

    ss = sub.add_parser("sprint-show",
                        help="detailed view of a sprint (active by default): goal, "
                             "committed stories + live columns, prep, WIP")
    ss.add_argument("id", nargs="?")
    ss.add_argument("--json", action="store_true")
    ss.set_defaults(fn=cmd_sprint_show)

    scl = sub.add_parser("sprint-close",
                         help="close the active sprint (alias of batch-close)")
    scl.add_argument("id")
    scl.set_defaults(fn=cmd_batch_close)

    scr = sub.add_parser("sprint-retro",
                         help="Sprint STEP 2: retro a closed sprint "
                              "(scaffold, or --accept/--reject a proposal)")
    scr.add_argument("--batch", help="BATCH-NNN to retro (default: latest closed)")
    scr.add_argument("--accept", metavar="P-N",
                     help="flip a proposal to accepted AND spawn an IDEA (Vision gate)")
    scr.add_argument("--reject", metavar="P-N", help="flip a proposal to rejected")
    scr.set_defaults(fn=cmd_sprint_retro)

    ex = sub.add_parser("exceptions", help="Exception gate queue: blocked work needing a human")
    ex.add_argument("--json", action="store_true")
    ex.set_defaults(fn=cmd_exceptions)

    # Idea inbox (#16 return-edge): provenance-stamped, firewalled from the build
    # loop. `idea-new` is the capture command; `sprint-retro --accept` reuses the
    # same writer so accepted workflow changes land here too (capture≠commit).
    inew = sub.add_parser("idea-new", help="capture an out-of-scope discovery to the inbox")
    inew.add_argument("--title")
    inew.add_argument("--born-from", dest="born_from", help="origin STORY/RETRO id")
    inew.add_argument("--found-by", dest="found_by", help="who/what surfaced it")
    inew.add_argument("--why", help="what SAD section / ADR the idea would need")
    inew.add_argument("--discovery-type", dest="discovery_type", default="out-of-scope")
    inew.add_argument("--id", help="IDEA-NNN (default: auto-numbered)")
    inew.set_defaults(fn=cmd_idea_new)

    il = sub.add_parser("idea-list", help="show the firewalled idea inbox")
    il.add_argument("--json", action="store_true")
    il.set_defaults(fn=cmd_idea_list)

    ia = sub.add_parser("idea-archive",
                        help=f"archive inbox ideas older than N days (default "
                             f"{STALE_IDEA_DAYS}) to keep the inbox high-signal")
    ia.add_argument("--days", type=int,
                    help=f"staleness horizon in days (default {STALE_IDEA_DAYS})")
    ia.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="list what would be archived without moving anything")
    ia.set_defaults(fn=cmd_idea_archive)

    s = sub.add_parser("show"); s.add_argument("id"); s.set_defaults(fn=cmd_show)
    sub.add_parser("render").set_defaults(fn=cmd_render)
    sub.add_parser("render-html",
                   help="write a self-contained backlog/index.html (kanban + traceability)"
                   ).set_defaults(fn=cmd_render_html)
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

    mt = sub.add_parser("metrics", help="retrospective off events.jsonl (#9)")
    mt.add_argument("--json", action="store_true")
    mt.add_argument("--sprint", help="scope to a sprint's window (BATCH-NNN)")
    mt.add_argument("--since", help="window start (ISO date/datetime)")
    mt.add_argument("--until", help="window end (ISO date/datetime)")
    mt.set_defaults(fn=cmd_metrics)

    rc = sub.add_parser("review-check"); rc.add_argument("id")
    rc.add_argument("--base", default="HEAD",
                    help="git ref to diff against (default HEAD; use the pre-story commit)")
    rc.set_defaults(fn=cmd_review_check)

    rr = sub.add_parser("review-record",
                        help="ingest code-reviewer findings as a gateable artifact (R-1)")
    rr.add_argument("id")
    rr.add_argument("--from", dest="from_",
                    help="read findings JSON from a file (default: stdin)")
    rr.set_defaults(fn=cmd_review_record)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
