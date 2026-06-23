---
name: idea-refiner
description: Turn a raw project idea into a structured project plan. Use this at the very start of the workflow when the user has a rough concept, pitch, or "I want to build X" and needs it sharpened into problem statement, users, success metrics, constraints, and explicit non-goals before architecture. Trigger on "refine this idea", "help me plan this project", "turn this into a project plan", or `/refine-idea IDEA-NNN PLAN-NNN`.
---

# Idea Refiner

Convert a raw idea into `backlog/plans/<plan-id>.md`. The user supplies **both
ids explicitly** (`/refine-idea IDEA-001 PLAN-001`). Read the source from
`backlog/ideas/<idea-id>.md` unless they paste the concept inline for a new
idea file. The job is to sharpen and bound — the **non-goals** section is the
first scope gate of the whole pipeline.

## Procedure
1. Confirm `<idea-id>` and `<plan-id>` match `IDEA-NNN` / `PLAN-NNN` conventions.
2. Interrogate the idea: who is it for, what problem, why now, what does
   success look like, what constraints (tech, time, compliance, budget).
3. Ask specifically what is OUT — the tempting adjacent features they'll
   resist. Write these down; they flow into `SAD#1.2` later.
4. Emit the plan with frontmatter `parent: <idea-id>` and this structure:

```
# Project Plan — {name}
## Problem
## Target users
## Success metrics      (measurable)
## Constraints
## Non-goals            (explicit, becomes SAD#1.2)
## Open questions
```

Keep it tight. This feeds the SAD; it is not the SAD.
