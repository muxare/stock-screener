#!/usr/bin/env python3
"""PreToolUse hook: auto-approve curl, but only against localhost.

Approves a *single* curl invocation whose every host token is loopback
(localhost / 127.0.0.1 / ::1). Anything chained, expanded, or pointing
elsewhere falls through to the normal permission prompt — so this widens
nothing beyond local requests and can't be used to reach external hosts.
"""
import json
import re
import shlex
import sys

data = json.load(sys.stdin)
if data.get("tool_name") != "Bash":
    sys.exit(0)

cmd = data.get("tool_input", {}).get("command", "")

# Refuse to reason about chained / expanded commands — fall through to a prompt.
if re.search(r"[;&|`]|\$\(", cmd):
    sys.exit(0)

try:
    parts = shlex.split(cmd)
except ValueError:
    sys.exit(0)

if not parts or parts[0] != "curl":
    sys.exit(0)

LOOPBACK = re.compile(r"^(https?://)?(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(/|$)")

# Flags that consume the following token as a value (so it isn't a host).
VALUE_FLAGS = {
    "-X", "--request", "-H", "--header", "-d", "--data", "--data-raw",
    "--data-binary", "--data-urlencode", "-o", "--output", "-A",
    "--user-agent", "-e", "--referer", "-b", "--cookie", "-c",
    "--cookie-jar", "-u", "--user", "-w", "--write-out", "-m",
    "--max-time", "--connect-timeout", "-T", "--upload-file", "-F", "--form",
}

# Collect non-flag tokens, skipping the value that follows a value-taking flag.
hosts = []
skip_next = False
for tok in parts[1:]:
    if skip_next:
        skip_next = False
        continue
    if tok.startswith("-"):
        if tok in VALUE_FLAGS:
            skip_next = True
        continue
    hosts.append(tok)

if hosts and all(LOOPBACK.match(h) for h in hosts):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "curl to localhost only",
        }
    }))

sys.exit(0)
