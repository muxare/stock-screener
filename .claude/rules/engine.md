---
paths:
  - "src/lib/**/*.ts"
---

# Engine rules (`src/lib/**`)

The indicator math, the Stock model and the fan screener run in **both** the browser
and the Node server. Anything that breaks in the browser breaks the app.

- No Node imports (`node:*`, `fs`, `path`) and no I/O. Data comes in as arguments.
- Keep functions pure: same bars in, same numbers out. No module-level mutable state.
- Changing indicator math changes past results. Update the golden tests in
  `tests/engine.golden.test.ts` in the same change, and say in the diary why the
  numbers moved.
- Before changing `fanBacktest.ts` or the signal rules, read phase 6.2 of
  `docs/platform-hardening-plan.md`: costs modelled, month-clustered t (never per-trade),
  trial count recorded.
- `npm run test` and `npm run lint` must pass before the change is done.
