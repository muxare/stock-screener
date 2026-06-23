# Project ideas for trying sad-wf

Raw **idea briefs** grouped by complexity. Drop one into a new project and run
the full pipeline:

```
cp docs/ideas/<tier>/<idea>.md → backlog/ideas/IDEA-001.md
/refine-idea IDEA-001 PLAN-001
/plan-to-sad PLAN-001 SAD-001
/sad-to-backlog SAD-001
/build-toward <capability>
```

**Already dogfooded:** [examples/taskledger/](../examples/taskledger/) — idea,
plan, SAD, backlog, and partial code. Use it to see a finished decomposition;
pick an idea below to run the pipeline yourself from scratch.

## Complexity tiers

| Tier | Folder | Stories (typical) | When to use |
|------|--------|-------------------|-------------|
| **Small** | [small/](small/) | 4–6 | First end-to-end run; learn the pipeline |
| **Medium** | [medium/](medium/) | 6–10 | Multi-capability slices, richer review-check |
| **Large** | [large/](large/) | 10–15 | Stress backlog-decomposer and SAD anchor density |

---

## Small (~4–6 stories)

| Idea | File | Best for practicing |
|------|------|---------------------|
| Quote jar | [quote-jar.md](small/quote-jar.md) | Shortest path to green; JSON persistence |
| Word counter | [word-counter.md](small/word-counter.md) | Minimal parsing and CLI flags |
| Markdown TOC | [markdown-toc.md](small/markdown-toc.md) | Text parsing, file Touch scope |
| Pomodoro timer | [pomodoro-timer-cli.md](small/pomodoro-timer-cli.md) | Time/state, interrupt handling |
| ASCII banner | [ascii-banner.md](small/ascii-banner.md) | Fixed data + layout, tiny tree |

**Suggested first run:** [quote-jar.md](small/quote-jar.md) or [word-counter.md](small/word-counter.md).

---

## Medium (~6–10 stories)

| Idea | File | Best for practicing |
|------|------|---------------------|
| Checksum watch | [checksum-watch.md](medium/checksum-watch.md) | Polling, state, multiple components |
| URL health report | [url-health-report.md](medium/url-health-report.md) | I/O boundaries, error handling, reports |
| Env profile switcher | [env-profile-switcher.md](medium/env-profile-switcher.md) | File safety, developer ergonomics |
| Habit streak CLI | [habit-streak-cli.md](medium/habit-streak-cli.md) | Dates, persistence, streak logic |
| Duplicate finder | [duplicate-finder.md](medium/duplicate-finder.md) | Hashing, grouping, optional cleanup |
| Changelog from git | [changelog-from-git.md](medium/changelog-from-git.md) | Git subprocess, commit classification |
| Port checker | [port-checker.md](medium/port-checker.md) | TCP probes, batch reports |
| Local backlog visualizer | [backlog-viz.md](medium/backlog-viz.md) | Read-only kanban for sad-wf; localhost HTTP |

**Suggested second run:** [checksum-watch.md](medium/checksum-watch.md) or [duplicate-finder.md](medium/duplicate-finder.md). To dogfood sad-wf itself, try [backlog-viz.md](medium/backlog-viz.md).

---

## Large (~10–15 stories)

| Idea | File | Best for practicing |
|------|------|---------------------|
| Config merge tool | [config-merge-tool.md](large/config-merge-tool.md) | Nested data, validation, richer SAD#6 |
| OpenAPI mock server | [openapi-mock-server.md](large/openapi-mock-server.md) | Spec parsing, HTTP routing, mock responses |
| SQL migration runner | [sql-migration-runner.md](large/sql-migration-runner.md) | Transactions, checksums, idempotent apply |
| RBAC policy checker | [rbac-policy-checker.md](large/rbac-policy-checker.md) | Policy model, wildcards, explain decisions |

**Suggested stretch run:** [config-merge-tool.md](large/config-merge-tool.md) after one small and one medium idea.

---

## Using an idea in a fresh repo

```bash
mkdir my-trial && cd my-trial
# copy sad-wf workflow files (.claude, tools, backlog templates, docs/ideas/)
cp /path/to/sad-wf/docs/ideas/small/quote-jar.md backlog/ideas/IDEA-001.md
/refine-idea IDEA-001 PLAN-001
```

Or stay inside sad-wf on a branch and add `backlog/ideas/IDEA-001.md` — just
don't commit trial artifacts to main unless you mean to keep them.
