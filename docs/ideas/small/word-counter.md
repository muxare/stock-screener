# Idea — Word counter

A CLI that reports word count, line count, and character count for one file or
stdin. Optional `--ignore-blank` to skip empty lines. Output as plain text or
JSON for scripting.

## Seed non-goals (for refine-idea)
- No recursive directory batch mode.
- No readability scores (Flesch-Kincaid) or language detection.
- No PDF, DOCX, or binary formats — text only.
- No watch mode or file change notifications.

## Why this idea fits sad-wf
Smallest possible pipeline run: parsing, formatting, CLI flags. Ideal when you
want to validate `/refine-idea` and `/plan-to-sad` without much implementation.

## Rough capabilities (hint for SAD#3)
- `text.analyze` — counts for a string or stream
- `cli.report` — format output, read file or stdin
