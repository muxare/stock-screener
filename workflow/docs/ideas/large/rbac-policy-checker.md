# Idea — RBAC policy checker

Evaluate whether a user (with roles and optional direct permissions) may perform
an action on a resource. Policies live in YAML: roles grant permissions;
resources declare required permission patterns (`read:reports`, `write:users/*`).
CLI: `check --user alice --action read:reports --resource /reports/q1`.

## Seed non-goals (for refine-idea)
- No HTTP API or middleware integration — CLI/library only.
- No audit log persistence or policy versioning UI.
- No ABAC attributes beyond role + direct grants (no IP, time-of-day).
- No LDAP or OIDC user sync.

## Why this idea fits sad-wf
Richest trial idea: policy model, wildcard matching, conflict rules, and clear
non-goals to resist scope creep. Expect 12–15 stories if decomposed fully.

## Rough capabilities (hint for SAD#3)
- `policy.load` — parse users, roles, resources from YAML
- `auth.match` — wildcard permission matching
- `auth.evaluate` — allow/deny with reason string
- `cli.check` — single evaluation command
- `cli.explain` — show role chain for a decision (stretch)
