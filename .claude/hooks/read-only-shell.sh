#!/usr/bin/env bash
# PreToolUse on Bash, scoped to the review subagents in .claude/agents/.
#
# Those agents are specified as read-only, and their `tools:` frontmatter cannot say so:
# a subagent's tool list is whole-tool granularity, so `Bash(git diff:*)` there would
# remove Bash entirely rather than narrow it. This hook is the narrowing — the documented
# idiom for a read-only agent that still needs a shell. It allows the commands a reviewer
# reads with and refuses every command that changes something, so an agent that returns
# findings cannot land them.
#
# Conservative by construction. Every segment of a pipeline, and every command
# substitution, is validated on its own first word; anything unparseable is refused
# rather than guessed at.
set -uo pipefail

input=$(cat)
[ "$(printf '%s' "$input" | jq -r '.tool_name // empty')" = "Bash" ] || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Redirection, background jobs and statement separators all exist to make something
# happen, which is the thing being refused; without them a first-word allowlist is enough
# to reason about.
case "$cmd" in
  *'>'*|*'`'*|*'&'*|*';'*)
    deny "This agent reviews and reports; it does not change anything. Redirection, background jobs and ';' are refused. Read files with the Read tool, search with Grep, and use a plain pipeline if you need one." ;;
esac

# git subcommands that only read. Deliberately short: add to it when a review needs more,
# never to make a write possible.
git_ok=" log diff show status blame merge-base rev-parse rev-list ls-files ls-tree cat-file shortlog describe symbolic-ref name-rev "
# Everything else a reviewer legitimately runs.
cmd_ok=" cat head tail wc grep rg find ls sort uniq cut tr jq date basename dirname printf echo paste nl column comm true "

validate_segment() {
  local seg=$1 first second
  # strip leading whitespace and any VAR=value prefixes
  seg=${seg#"${seg%%[![:space:]]*}"}
  while [[ $seg =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+ ]]; do
    seg=${seg#"${BASH_REMATCH[0]}"}
  done
  [ -n "$seg" ] || return 0
  read -r first second _ <<<"$seg"
  case "$first" in
    git)
      [ -n "$second" ] || return 0
      # `git branch` reads or destroys depending on its flags, so it cannot go in the
      # subcommand list; the read-only forms are matched whole. Resolving the current
      # branch is the first thing both auditors do.
      case "$seg" in
        "git branch"|"git branch -a"|"git branch --all"|"git branch -v"|"git branch -vv"|\
        "git branch -av"|"git branch --show-current"|"git branch --list "*) return 0 ;;
      esac
      case "$git_ok" in
        *" $second "*) return 0 ;;
        *) deny "\`git $second\` is refused: this agent is read-only and returns findings, not changes. The read-only git it has is:${git_ok}" ;;
      esac ;;
    gh)
      case "$seg" in
        "gh pr view"*|"gh pr diff"*|"gh pr list"*|"gh pr checks"*) return 0 ;;
        *) deny "Only \`gh pr view|diff|list|checks\` is available to this agent. Anything that writes to GitHub — a comment, a review, a merge — is the caller's decision, not the reviewer's." ;;
      esac ;;
    npm|npx|node|pnpm|yarn)
      deny "This agent does not run the project's scripts or any Node process; it reads the code and reports. Running the gates is \`/verify\`'s job, and CI's." ;;
    *)
      case "$cmd_ok" in
        *" $first "*) return 0 ;;
        *) deny "\`$first\` is not available to this read-only agent. Use Read, Grep and Glob for the code, read-only git for the history, and report what you find." ;;
      esac ;;
  esac
}

validate_list() {
  local list=$1 seg
  while IFS= read -r seg; do
    [ -n "${seg//[[:space:]]/}" ] || continue
    validate_segment "$seg"
  done < <(printf '%s\n' "$list" | tr '|' '\n')
}

# Validate the innermost command substitutions, then peel them off and validate what is
# left. `git diff $(git merge-base HEAD main)..HEAD` is the idiom every skill here uses,
# so it has to pass, and both halves of it have to be checked.
work=$cmd
depth=0
while printf '%s' "$work" | grep -q '\$('; do
  depth=$((depth + 1))
  [ "$depth" -gt 8 ] && deny "This command nests command substitutions too deeply to check. Break it into separate calls."
  inners=$(printf '%s' "$work" | grep -o '\$([^()]*)' | sed 's/^\$(//; s/)$//')
  [ -n "$inners" ] || deny "The command substitution in this command is unbalanced, so it cannot be checked. Rewrite it as separate calls."
  while IFS= read -r one; do
    [ -n "${one//[[:space:]]/}" ] && validate_list "$one"
  done <<EOF
$inners
EOF
  work=$(printf '%s' "$work" | sed 's/\$(\([^()]*\))/ \1 /g')
done
validate_list "$work"
exit 0
