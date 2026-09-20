#!/usr/bin/env bash
# Stop: when the working tree has uncommitted changes under src/ or server/, run the
# test suite before the turn ends and hand the result back as Stop feedback.
#
# The suite is 541 tests in about two seconds, which is cheap enough to run rather than
# to remind about. `git status --porcelain` is the trigger rather than `git diff` because
# it also sees a new file that has not been added yet; committed work is left alone, on
# the grounds that it was finished deliberately and CI is about to run the same suite.
#
# Advisory in force: it returns `hookSpecificOutput.additionalContext`, which the docs
# describe as non-error feedback, rather than `decision: "block"`. The turn continues so
# Claude can act on a failure, and the transcript labels it Stop hook feedback instead of
# a hook error. `stop_hook_active` stops it from firing again on that continuation.
set -uo pipefail

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "${root:-}" ] && [ -d "$root/src" ] || exit 0

changed=$(git -C "$root" status --porcelain -- src server 2>/dev/null)
[ -n "$changed" ] || exit 0

output=$(cd "$root" && npm run test 2>&1)
status=$?
[ "$status" -eq 0 ] && exit 0

# Vitest prints one `FAIL <file> > <test>` line per failure and a `Tests  ...` tally.
failures=$(printf '%s\n' "$output" | grep -E '^ *(FAIL|Tests|Test Files) ' | head -12)
[ -n "$failures" ] || failures=$(printf '%s\n' "$output" | tail -12)

message="npm run test exits non-zero with the current uncommitted changes under src/ or server/. The run reports:"$'\n'"$failures"$'\n'"The full output is available by running npm run test."

jq -n --arg message "$message" '{
  hookSpecificOutput: {
    hookEventName: "Stop",
    additionalContext: $message
  }
}'
