# Idea — URL health report

Read a list of URLs from a text file (one per line), request each with a timeout,
record status code and elapsed ms, and write a Markdown or CSV report. Failed
requests (timeout, DNS, 5xx) should appear clearly — not silently dropped.

## Seed non-goals (for refine-idea)
- No scheduling, cron, or continuous monitoring.
- No alerting (PagerDuty, Slack, email).
- No browser rendering or JavaScript execution.
- No auth flows beyond optional static Bearer token in config.

## Why this idea fits sad-wf
Forces explicit **error handling** and **out-of-scope** boundaries (network
failures vs bugs). Report output makes acceptance criteria concrete.

## Rough capabilities (hint for SAD#3)
- `fetch.check` — HTTP GET/HEAD with timeout
- `report.format` — markdown table or CSV
- `cli.batch` — read URL file, write report file
