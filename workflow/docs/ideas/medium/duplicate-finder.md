# Idea — Duplicate file finder

Scan one or more directories and report groups of files with identical content
(SHA-256). Print human-readable groups with paths and total wasted bytes.
Optional `--delete-duplicates keep=oldest` for interactive cleanup (confirm
each group).

## Seed non-goals (for refine-idea)
- No similarity matching (perceptual hash, near-duplicates).
- No cloud storage paths (S3, GCS).
- No automatic deletion without explicit flag and confirmation.
- No indexing service or persistent database across runs.

## Why this idea fits sad-wf
Combines filesystem I/O, hashing, and grouped output — enough capabilities for
multi-story `/build-toward` slices without a large SAD.

## Rough capabilities (hint for SAD#3)
- `hash.file` — stream hash for large files
- `scan.walk` — directory traversal with ignore rules
- `dup.group` — bucket by digest, compute savings
- `cli.report` — table output and optional delete flow
