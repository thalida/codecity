#!/usr/bin/env python3
"""Pick a free host port for a justfile recipe and persist it.

Usage: pick-port.py <key>

Reads .local/worktree-ports.json (creating it if missing). If <key> already
has a port AND that port is still free on the host, reuses it. Otherwise
picks a fresh free port from the OS. Writes the file back and prints the
chosen port to stdout.

Why bind-test instead of connect-test: docker -p binding fails when ANY
process holds the port (listening or not). bind() with SO_REUSEADDR=0
matches docker's behavior better than connect_ex().
"""
import json
import pathlib
import socket
import sys


def port_free(port: int) -> bool:
    """Return True if we can bind to the port on all interfaces."""
    s = socket.socket()
    try:
        s.bind(("", port))
    except OSError:
        return False
    finally:
        s.close()
    return True


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

    p = pathlib.Path(".local/worktree-ports.json")
    p.parent.mkdir(exist_ok=True)
    data = json.loads(p.read_text()) if p.exists() else {}

    existing = data.get(key)
    if existing is None or not port_free(int(existing)):
        data[key] = pick_free_port()
        p.write_text(json.dumps(data))

    print(data[key])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
