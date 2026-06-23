# Idea — Env profile switcher

Developers maintain named env files (`.env.dev`, `.env.staging`) and switch the
**active** env for local runs by copying or symlinking to `.env`. CLI:
`env-profile list`, `env-profile use dev`, `env-profile show` (print active
name without printing secrets).

## Seed non-goals (for refine-idea)
- No secret manager integration (Vault, 1Password).
- No variable-level merge — whole-file swap only.
- No Docker or Kubernetes deployment.
- No encryption at rest.

## Why this idea fits sad-wf
Practices **file safety** (don't corrupt `.env`), **explicit non-goals** around
secrets, and stories that touch the filesystem — review-check scope matters.

## Rough capabilities (hint for SAD#3)
- `profile.discover` — find `.env.*` profiles
- `profile.activate` — safe switch (backup current `.env`?)
- `cli.commands` — list / use / show
