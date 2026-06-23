# Idea — Markdown TOC

A CLI that scans a Markdown file for `#` headings and inserts or refreshes a
**Table of contents** block after the title. The TOC uses relative `#` links.
Running it twice should be idempotent — same headings, updated anchors only if
headings changed.

## Seed non-goals (for refine-idea)
- No whole-site or multi-file batch mode (single file per invocation).
- No HTML/PDF output — Markdown in, Markdown out.
- No GUI or editor plugin.
- No translation, spell-check, or lint rules.

## Why this idea fits sad-wf
Pure string/file work: good for practicing **Touch scope** on one path glob
(`src/**` + `tests/**`) and acceptance criteria that are easy to verify.

## Rough capabilities (hint for SAD#3)
- `md.parse` — extract heading hierarchy
- `md.toc` — render TOC block
- `md.apply` — splice TOC into file (preserve body outside TOC region)
