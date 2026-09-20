---
paths:
  - "docs/**/*.md"
---

# Docs rules (`docs/**`)

Two kinds of document live here: plans and the diary.

**Plans** (`docs/<feature>-plan.md`) open with a dated status line in bold
(`Status (YYYY-MM-DD): **proposed | in progress | complete**`), then context, a phases
table, and per phase a **Touch scope** line and a **Verify** line. Update the status line
when a phase lands.

**The diary** (`docs/development-diary.md`) is the running record. Newest entry first,
one entry per landed phase, headed `## YYYY-MM-DD — <short title>`, and it says three
things: what changed, where it lives, how to test it.

Use absolute dates, never "last week". Prose, not bullet soup — explain why, not just what.
