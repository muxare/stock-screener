---
paths:
  - "server/**/*.ts"
---

# Server rules (`server/**`)

- `handlers.ts` is transport-agnostic: parsed request + warm universe → plain result.
  Keep HTTP details (status codes, headers, streams) in `index.ts`.
- New endpoints get a handler in `handlers.ts` first, then a route that wraps it.
- `RequestError` is the 400 signal. Throw it for bad input; anything else is a 500.
- `/dev/*` routes stay behind the `DEV_TOOLS` flag and are registered only when it is set.
- `npm run test` and `npm run lint` must pass before the change is done.
