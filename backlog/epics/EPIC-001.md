---
id: EPIC-001
type: epic
parent: ~
sad: SAD-001
sad_refs: SAD#3, SAD#5.1, SAD#5.3, SAD#5.6
capabilities: CAP-screen, CAP-setups, CAP-screens, CAP-patterns, CAP-rank, CAP-indicators, CAP-presets, CAP-pcf
---

# EPIC-001 — Rule authoring & screening

Compose, save, and run technical screens against the universe with full POC
parity — the rule engine, condition/chain/pattern/rank builders, indicator and
preset authoring, and TC2000 PCF import. This is the core authoring loop.

## Goal
A trader can build a custom screen from scratch (custom indicators, condition
groups, chains, patterns, ranking, or a pasted PCF) and run it, with results
matching the POC engine (SAD#1.1, SAD#2.1).

## Capabilities covered
- `CAP-screen` (SAD#3.1)
- `CAP-setups` (SAD#3.4)
- `CAP-screens` (SAD#3.6)
- `CAP-patterns` (SAD#3.7)
- `CAP-rank` (SAD#3.8)
- `CAP-indicators` (SAD#3.3)
- `CAP-presets` (SAD#3.2)
- `CAP-pcf` (SAD#3.5)

## Status note
As-built in `src/` (React + `src/lib/market.ts`). Capability behaviour is
present; automated POC-parity verification is tracked separately under
EPIC-004 / FEAT-011.

## Notes
- Features under this epic live in `backlog/features/FEAT-*.md` with `parent: EPIC-001`.
