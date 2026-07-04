# Idea — SQL migration runner

Apply ordered `.sql` files from a `migrations/` folder to a SQLite database.
Track applied migrations in a `schema_migrations` table with filename and
checksum. Support `up` (apply pending), `status` (list applied/pending), and
`dry-run` (print SQL without executing).

## Seed non-goals (for refine-idea)
- No PostgreSQL or MySQL — SQLite only for the trial.
- No down/rollback migrations in v1.
- No online multi-node locking.
- No GUI or web console.

## Why this idea fits sad-wf
Forces careful **SAD#6 data rules**, transactional apply, and idempotency
stories. Good stress test for review-check when touching `migrations/` vs
`src/`.

## Rough capabilities (hint for SAD#3)
- `migrate.discover` — sort files, compute checksums
- `migrate.apply` — transaction per file, record version
- `migrate.status` — pending vs applied report
- `db.connect` — SQLite connection lifecycle
- `cli.commands` — up, status, dry-run
