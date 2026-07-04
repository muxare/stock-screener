# Idea — Checksum watch

Watch a directory and print (or log) when any file's SHA-256 checksum changes.
Useful when you're waiting for a build artifact or log file to update. One-shot
mode scans now; watch mode polls every N seconds until Ctrl+C.

## Seed non-goals (for refine-idea)
- No recursive ignore of `.git` beyond a simple default — user passes paths.
- No cloud storage, S3, or remote paths.
- No virus scanning or mime detection — checksum only.
- No daemon/install as system service.

## Why this idea fits sad-wf
Exercises **state** (last-known hashes), **polling loop**, and clear SAD#2
constraints (performance budget on large dirs). Good second project after Quote jar.

## Rough capabilities (hint for SAD#3)
- `hash.scan` — compute checksums for paths
- `watch.poll` — compare snapshots, emit changes
- `cli.run` — one-shot vs watch modes
