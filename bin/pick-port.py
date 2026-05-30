#!/usr/bin/env python3
"""Pick a free host port for a justfile recipe and persist it.

Usage: pick-port.py <key>

Reads .local/worktree-ports.json (creating it if missing). If <key> already
has a port, prints it unconditionally — even if the host port is currently
occupied. The script does NOT silently re-allocate: a saved port is treated
as a hard commitment so bookmarked URLs (and `just dev` ergonomics) stay
stable across container restarts and Docker hangs. If the port is busy
(e.g. a stale container still bound to it), the recipe will fail when it
tries to bind, with a clear "port already in use" message — the right
remediation is to free the port, not to silently move it.

If <key> has no saved port, picks a fresh free port from the OS, saves it,
and prints it. This is the only path that allocates.

Only KNOWN_KEYS are persisted; any other keys present in the file (e.g.
legacy `vite_port`/`api_port` from earlier naming) are dropped on the next
write. This way the file converges to the current schema without manual
cleanup.

Why bind-test instead of connect-test was used historically: docker -p
binding fails when ANY process holds the port. We no longer need this
since we don't auto-reallocate, but the helper is kept in case future
recipes want it.
"""
import json
import pathlib
import socket
import sys

# Keys this script is willing to manage. Anything else gets dropped on write.
KNOWN_KEYS = {"vite", "run"}


def pick_free_port() -> int:
    s = socket.socket()
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: pick-port.py <key>", file=sys.stderr)
        return 2
    key = sys.argv[1]
    if key not in KNOWN_KEYS:
        print(
            f"error: unknown key {key!r}; expected one of {sorted(KNOWN_KEYS)}",
            file=sys.stderr,
        )
        return 2

    p = pathlib.Path(".local/worktree-ports.json")
    p.parent.mkdir(exist_ok=True)
    raw = json.loads(p.read_text()) if p.exists() else {}
    # Drop legacy / unknown keys on read so we never persist them again.
    data = {k: v for k, v in raw.items() if k in KNOWN_KEYS}

    if key not in data:
        data[key] = pick_free_port()
        p.write_text(json.dumps(data))
    elif data != raw:
        # Schema converged (legacy keys removed) — write the cleaned file
        # even though the chosen port itself didn't change.
        p.write_text(json.dumps(data))

    print(data[key])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
