# Idea — Port checker

Read `host:port` pairs from a file (one per line), attempt a TCP connect with
a timeout, and write a report: open, closed, or timeout. Summary line at the
top with counts. Useful for pre-deploy smoke checks on a static server list.

## Seed non-goals (for refine-idea)
- No UDP, ICMP ping, or HTTP health paths.
- No continuous monitoring or alerting.
- No SSH tunneling or proxy configuration.
- No IPv6 (IPv4 only for the trial scope).

## Why this idea fits sad-wf
Parallel to URL health report but at the socket layer — compare how you write
non-goals and error handling across similar ideas.

## Rough capabilities (hint for SAD#3)
- `net.probe` — TCP connect with timeout
- `report.format` — Markdown or CSV table
- `cli.batch` — read targets file, write report
