# Idea — OpenAPI mock server

Load an OpenAPI 3.x YAML/JSON spec and serve mock HTTP responses for declared
paths. Return example payloads from the spec when present; otherwise synthesize
placeholder JSON from schema types. Log each request to stdout.

## Seed non-goals (for refine-idea)
- No auth middleware beyond static API-key header check (optional stretch).
- No persistence, database, or stateful sessions.
- No Swagger UI or spec editing.
- No WebSockets or streaming responses.

## Why this idea fits sad-wf
Large enough for 10+ stories: spec parsing, routing, response generation,
CLI (port/bind). Strong test for capability slicing and SAD anchor density.

## Rough capabilities (hint for SAD#3)
- `spec.load` — parse and validate OpenAPI subset
- `mock.route` — match method + path pattern
- `mock.respond` — examples vs schema-driven placeholders
- `server.http` — bind, graceful shutdown
- `cli.serve` — flags for spec path, port, host
