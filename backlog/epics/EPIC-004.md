---
id: EPIC-004
type: epic
parent: ~
sad: SAD-001
sad_refs: SAD#2.1, SAD#2.7, SAD#2.8, SAD#2.9, SAD#5.8, SAD#6.4
capabilities: CAP-presets, CAP-screen, CAP-results, CAP-detail
---

# EPIC-004 — Persistence, fidelity & compliance

Cross-cutting quality the SAD binds but the as-built app only partly meets:
artifact persistence behind a repository abstraction, a golden-master fidelity
harness for the engine, latency instrumentation, the not-investment-advice
disclosure on every signal surface, and chart accessibility.

## Goal
Every SAD#2 quality posture is enforced by something checkable: parity tests
(SAD#2.1), durable artifacts behind an interface (SAD#2.8), disclosure
everywhere (SAD#2.7), measured latency (SAD#2.3/2.4), and keyboard-operable
charts (SAD#2.9).

## Capabilities covered
- `CAP-presets` (SAD#3.2) — persistence abstraction
- `CAP-screen` (SAD#3.1) — fidelity + latency
- `CAP-results` (SAD#3.9) — disclosure
- `CAP-detail` (SAD#3.10) — accessibility

## Status note
Partial: persistence exists as direct `localStorage` (not behind a repository);
disclosure exists only on the backtest modal; no tests; latency unmeasured.

## Notes
- Features under this epic live in `backlog/features/FEAT-*.md` with `parent: EPIC-004`.
