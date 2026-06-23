# Idea — Changelog from git

Generate a Markdown changelog from git history between two refs. Group commits
by Conventional Commit type (`feat`, `fix`, …) when the subject matches;
otherwise bucket as **Other**. Support `--since-tag` and `--until-tag`.

## Seed non-goals (for refine-idea)
- No GitHub API or pull-request bodies.
- No semantic versioning bump suggestions.
- No interactive editor or merge conflict resolution.
- No publishing to npm, PyPI, or GitHub Releases.

## Why this idea fits sad-wf
Exercises subprocess/git boundaries, parsing rules, and report formatting.
Good practice for explicit SAD#2 constraints on which commits are included.

## Rough capabilities (hint for SAD#3)
- `git.log` — parse rev range, extract subject and hash
- `changelog.group` — classify and sort entries
- `cli.render` — Markdown sections, stdout or file
