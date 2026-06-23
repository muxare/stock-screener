# Idea — Pomodoro timer CLI

A terminal Pomodoro timer: start a 25-minute focus block, notify when it ends,
optionally chain a 5-minute break. Show remaining time on demand. No background
daemon — the process runs until the session completes or you Ctrl+C.

## Seed non-goals (for refine-idea)
- No desktop notifications or OS integration beyond terminal bell.
- No task tracking, project labels, or statistics dashboard.
- No sound files or Spotify integration.
- No multi-user or sync across machines.

## Why this idea fits sad-wf
Minimal domain with clear time boundaries — good for practicing acceptance
criteria around duration, interrupt handling, and idempotent `status` output.

## Rough capabilities (hint for SAD#3)
- `timer.session` — focus/break state machine
- `timer.display` — countdown / remaining time
- `cli.run` — start, status, cancel
