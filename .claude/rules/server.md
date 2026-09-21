---
paths:
  - "server/**/*.ts"
---

# Server rules (`server/**`)

- `handlers.ts` is transport-agnostic: parsed request + warm universe → plain result.
  Keep HTTP details (status codes, headers, streams) in `app.ts` and `routes/*`.
- New endpoints get a handler in `handlers.ts` first, then a route plugin that wraps it.
- `RequestError` is the 400 signal. Throw it for bad input; anything else is a 500.
- `/dev/*` routes stay behind the `DEV_TOOLS` flag and are registered only when it is set.
- Read the environment through `config.ts`, never `process.env`. A module that needs a
  variable takes a `ServerConfig`.
- Log through the request's `request.log`, or `logger.ts` outside a request. No `console.*`,
  and never log a request or response body.
- `npm run test` and `npm run lint` must pass before the change is done.
