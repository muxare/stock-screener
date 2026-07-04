# Idea — Quote jar

A command-line tool to save short quotes you stumble on and print a random one
when you need a nudge. Quotes live in a local JSON file. Add with a one-liner,
list all, pick random — nothing else.

## Seed non-goals (for refine-idea)
- No tags, search, or full-text index.
- No authors database or Wikiquote integration.
- No TUI, web UI, or desktop notifications.
- No encryption or multi-user sync.

## Why this idea fits sad-wf
Small surface area: model, in-memory store, file persistence, tiny CLI — mirrors
Taskledger but different domain so you can't cargo-cult the example.

## Rough capabilities (hint for SAD#3)
- `quote.model` — quote entity (text, optional source, id)
- `quote.store` — add, list, random
- `persist.file` — JSON save/load
