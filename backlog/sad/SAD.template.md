---
id: SAD-000
type: sad
parent: PLAN-000
status: Draft
---

# Software Architecture Document — {PROJECT NAME}

> **Status:** Draft | Reviewed | Approved
> **Version:** 0.1
> **This document is the binding architectural contract.** Every backlog
> story references sections of this document by anchor (e.g. `SAD#6.1`).
> Implementation must not contradict an approved section. Conflicts are
> escalated, not improvised away.

## Anchor convention

Every section that an implementation could depend on carries a stable
anchor of the form `SAD#<number>` (and sub-anchors `SAD#<number>.<n>`).
**Never renumber an anchor once stories reference it** — append instead.
Stories cite these anchors in their `sad_refs` frontmatter; the
backlog-decomposer enforces that every story references at least one.

---

## SAD#1 Context & Scope
What the system is, who uses it, what problem it solves. The boundary of
the system: what is inside, what is explicitly outside.

### SAD#1.1 In scope
### SAD#1.2 Out of scope (non-goals)
> This list is a primary scope-creep defense. A story that builds something
> here is invalid by definition.

## SAD#2 Quality Attributes & Constraints
Non-functional requirements that bind implementation: performance budgets,
security posture, compliance, availability, accessibility. Each should be
phrased so a story can be checked against it.

## SAD#3 Capabilities
The functional units the system provides. **Capabilities are the unit of
work** — the build loop slices on these. Each capability gets an id.

### SAD#3.x <capability-id>: <name>
- **What it does:**
- **Primary components (refs SAD#5):**
- **Acceptance posture:** how we know this capability is "done"

## SAD#4 Containers
Deployable/runnable units (services, apps, edge modules, databases) and how
they communicate. One anchor per container.

### SAD#4.x <container name>

## SAD#5 Components
Internal structure within containers: modules, key classes, responsibilities,
patterns to use (and patterns NOT to use). This is what story prompts cite
most often, so be concrete.

### SAD#5.x <component name>

## SAD#6 Data
Data model, ownership, persistence choices, state/consistency rules,
migrations. Reconciliation/conflict rules live here.

### SAD#6.x <data area>

## SAD#7 Cross-cutting Concerns
Auth, logging, error handling, config, observability, i18n — anything that
spans components and that a story might otherwise reinvent.

## SAD#8 Decisions (ADRs)
Numbered, dated architectural decisions with context and consequences.
Stories cite these when a choice constrains them.

### SAD#8.x ADR-<n>: <title>
- **Context:**
- **Decision:**
- **Consequences:**
- **Status:** proposed | accepted | superseded
