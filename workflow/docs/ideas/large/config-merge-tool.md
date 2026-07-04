# Idea — Config merge tool

Merge two JSON or YAML config files with explicit rules: deep-merge objects,
replace arrays by default, and a `--no-overwrite` flag for keys that exist only
in the base file. Output to stdout or a third file. Fail with a clear error on
invalid syntax or type clashes (string over object).

## Seed non-goals (for refine-idea)
- No TOML, INI, or HCL — JSON and YAML only.
- No schema validation (JSON Schema, Cerberus).
- No interactive diff UI.
- No cloud config services (Consul, etcd).

## Why this idea fits sad-wf
Largest suggested trial: richer **SAD#6 data rules**, more capabilities, and
stories that are easy to over-scope — good for testing backlog-decomposer and
capability slicing on `/build-toward config.merge` vs `config.cli`.

## Rough capabilities (hint for SAD#3)
- `config.parse` — load JSON/YAML safely
- `config.merge` — deep merge with array policy
- `config.validate` — type clash detection
- `cli.merge` — flags, stdin/stdout
