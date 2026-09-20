#!/usr/bin/env bash
# Print the touch-scope paths declared by the plan phase this branch is named for, one
# per line, and exit 0. Print nothing whenever the branch, the plan, the phase or the
# scope line cannot be resolved: a scope check that guesses is worse than none.
#
# Branch convention, the same one `.claude/skills/touch-scope` falls back to:
#   cca-f/phase-a-3-hooks       -> docs/cca-f-learning-plan.md,   phase A
#   feat/screener-parity-phase1 -> docs/screener-parity-plan.md,  phase 1
#
# Only the `Touch scope:` line form is read, and only the paths it puts in backticks.
# Plans that declare scope in a table column (borsdata, screener-parity) are not
# resolvable here and yield nothing; `/touch-scope` reads those with a model.
#
# Run it by hand to see what the hooks will use:  .claude/hooks/plan-scope.sh
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "${root:-}" ] && [ -d "$root/docs" ] || exit 0

# CLAUDE_HOOK_BRANCH overrides the branch so the resolver can be exercised against a
# branch name you are not on. It only widens or narrows an advisory warning.
branch="${CLAUDE_HOOK_BRANCH:-$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)}"
[ -n "$branch" ] || exit 0
key=$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | tr '/_' '--')
case "$key" in *phase*) ;; *) exit 0 ;; esac

# 1. The plan: the docs/*-plan.md whose slug, or the longest prefix of it, appears in
#    the branch name. Longest wins, so `screener-parity` beats a four-letter accident.
plan=""; best=0
for candidate in "$root"/docs/*-plan.md; do
  [ -f "$candidate" ] || continue
  slug=$(basename "$candidate"); slug=${slug%-plan.md}
  frag=$slug
  while [ ${#frag} -ge 4 ]; do
    case "$key" in
      *"$frag"*)
        if [ ${#frag} -gt "$best" ]; then best=${#frag}; plan=$candidate; fi
        break ;;
    esac
    prev=$frag; frag=${frag%-*}
    [ "$frag" = "$prev" ] && break
  done
done
[ -n "$plan" ] || exit 0

# 2. The phase: the token straight after `phase` in the branch name. `a` from
#    `phase-a-3-hooks`, `1` from `phase1`. Phases are declared per letter or per number;
#    a sub-phase such as A.3 lives inside the `Phase A` section.
rest=${key#*phase}; rest=${rest#-}
sec=${rest%%-*}
sec=$(printf '%s' "$sec" | tr '[:lower:]' '[:upper:]')
[ -n "$sec" ] || exit 0

# 3. The section: `## Phase A`, `### Phase A`, `## Stage 3` ... up to the next heading
#    at the same or a shallower level.
start=$(grep -nE "^#{2,4} +(Phase|Stage) +${sec}([^A-Za-z0-9]|$)" "$plan" | head -1 | cut -d: -f1)
[ -n "$start" ] || exit 0
depth=$(sed -n "${start}p" "$plan" | sed -E 's/^(#+).*/\1/' | tr -d '\n' | wc -c | tr -d ' ')
end=$(awk -v s="$start" -v d="$depth" '
  NR > s && /^#+ / { n = index($0, " ") - 1; if (n <= d) { print NR - 1; exit } }
' "$plan")
[ -n "$end" ] || end=$(wc -l < "$plan")

# 4. The scope lines, continuation lines included: a wrapped `Touch scope:` continues on
#    an indented line that does not start a new bullet.
scope=$(sed -n "${start},${end}p" "$plan" | awk '
  /^[-*]? *Touch scope:/ { collecting = 1; print; next }
  collecting && /^  +[^-*# ]/ { print; next }
  { collecting = 0 }
')
[ -n "$scope" ] || exit 0

# 5. Every declared path is in backticks; the prose around them ("as stage 3", "(new)",
#    "plus") is not. Take the backticked spans and normalise each to a path prefix.
{
  printf '%s\n' "$scope" | grep -oE '`[^`]+`' | tr -d '`' | while IFS= read -r entry; do
    entry=${entry%%[[:space:]]*}
    entry=${entry%/\*\*}; entry=${entry%/\*}; entry=${entry%/}
    entry=${entry%%[,.;)]}
    [ -n "$entry" ] && printf '%s\n' "$entry"
  done
  # The record of the work is always in scope, whatever the plan says.
  printf 'docs/development-diary.md\n'
  printf '%s\n' "${plan#"$root"/}"
} | sort -u
