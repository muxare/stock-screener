#!/usr/bin/env bash
# PostToolUse on Edit|Write: run eslint --fix over the one file that was just written.
#
# Advisory. It never blocks and never fails the turn; `npm run lint` in CI is the hard
# gate. What it buys is the feedback loop — a rule violation is reported next to the edit
# that caused it, not twenty edits later when someone remembers to run the suite.
#
# Two things go back to Claude as context: that the file was rewritten by --fix (so an
# edit built against the pre-fix text would miss), and any problem --fix could not repair.
set -uo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -n "$file" ] || exit 0

case "$file" in *.ts|*.tsx) ;; *) exit 0 ;; esac
[ -f "$file" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "${root:-}" ] || exit 0
case "$file" in "$root"/*) ;; *) exit 0 ;; esac
rel=${file#"$root"/}

eslint="$root/node_modules/.bin/eslint"
[ -x "$eslint" ] || exit 0

before=$(shasum -a 1 -- "$file" 2>/dev/null | cut -d' ' -f1)
output=$(cd "$root" && "$eslint" --fix --format json -- "$rel" 2>/dev/null)
after=$(shasum -a 1 -- "$file" 2>/dev/null | cut -d' ' -f1)

notes=""
[ "$before" != "$after" ] && notes="eslint --fix rewrote $rel, so its contents on disk differ from what was just written. Read it again before editing it further."

# A run that did not produce JSON is a broken hook, not a clean file. Say so rather than
# report silence: a lint check that quietly stops checking is worse than no check.
if ! printf '%s' "$output" | jq -e 'type == "array"' >/dev/null 2>&1; then
  notes="${notes:+$notes }The .claude/hooks/lint-edited.sh hook could not run eslint over $rel, so this file was not linted."
else
  problems=$(printf '%s' "$output" | jq -r --arg rel "$rel" '
    .[].messages[]
    | "\($rel):\(.line // 0):\(.column // 0) \(if .severity == 2 then "error" else "warning" end) \(.message) [\(.ruleId // "fatal")]"
  ' | head -10)
  if [ -n "$problems" ]; then
    notes="${notes:+$notes }eslint --fix could not repair these in $rel:"$'\n'"$problems"
  fi
fi

[ -n "$notes" ] || exit 0

jq -n --arg notes "$notes" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $notes
  }
}'
