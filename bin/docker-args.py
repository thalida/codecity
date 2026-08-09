#!/usr/bin/env python3
"""Turn the arguments of `just dev` / `just run` into docker config.

Usage: docker-args.py (compose|run) [-v PATH ...] [-e NAME=VALUE ...]

The recipes are thin wrappers over docker, and both things they forward are
docker concepts, so they take docker's own flags:

    just dev -v ~/Documents/Repos/myproj
    just dev -e CODECITY_HOSTED=1
    just dev -v ~/Documents/Repos/myproj -e CODECITY_HOSTED=1 -e CODECITY_DISCOVER=off

-v takes a bare path rather than docker's SRC:DST:MODE because codecity
supports exactly one mount shape: read-only at the same absolute path, so a
path the browser hands the api resolves to the same file inside the container.

A mount implies CODECITY_ALLOW_LOCAL_REPOS=1, which an explicit -e for the
same name replaces, so `just dev -v ~/repo -e CODECITY_ALLOW_LOCAL_REPOS=0`
still turns it off.

`compose` writes .local/dev.override.yml and prints the `-f` flag pointing at
it; `run` prints `-v`/`-e` flags for `docker run`. Both print nothing when
given no arguments, and describe what they did on stderr. Output is
shell-interpolated unquoted by the recipes, so paths containing spaces are
not supported.
"""

import argparse
import pathlib
import re
import sys

OVERRIDE = pathlib.Path(".local/dev.override.yml")

ENV_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="docker-args.py",
        description="Build docker config from `just dev` / `just run` arguments.",
    )
    parser.add_argument("mode", choices=("compose", "run"))
    parser.add_argument(
        "-v",
        "--volume",
        action="append",
        default=[],
        metavar="PATH",
        help="mount a directory read-only at the same absolute path (repeatable)",
    )
    parser.add_argument(
        "-e",
        "--env",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help="set an env var on the api container (repeatable)",
    )
    return parser.parse_args(argv)


def resolve_mounts(paths: list[str]) -> list[str]:
    mounts = []
    for raw in paths:
        path = pathlib.Path(raw).expanduser()
        if not path.is_dir():
            hint = " (env vars go in -e)" if ENV_ASSIGNMENT.match(raw) else ""
            raise SystemExit(f"error: -v {raw!r} is not a directory{hint}")
        mounts.append(str(path.resolve()))
    return mounts


def resolve_env(assignments: list[str], mounted: bool) -> list[str]:
    # Keyed by name so a repeated var resolves here rather than relying on
    # whether docker takes the first or the last of a duplicate.
    env: dict[str, str] = {}
    for raw in assignments:
        if not ENV_ASSIGNMENT.match(raw):
            hint = (
                " (paths go in -v)" if pathlib.Path(raw).expanduser().is_dir() else ""
            )
            raise SystemExit(f"error: -e {raw!r} is not NAME=VALUE{hint}")
        name, value = raw.split("=", 1)
        env[name] = value
    if mounted:
        env.setdefault("CODECITY_ALLOW_LOCAL_REPOS", "1")
    return [f"{k}={v}" for k, v in env.items()]


def describe(mounts: list[str], env: list[str]) -> None:
    for mount in mounts:
        print(f"[codecity] mounted {mount}", file=sys.stderr)
    for assignment in env:
        print(f"[codecity] {assignment}", file=sys.stderr)


def emit_compose(mounts: list[str], env: list[str]) -> str:
    if not mounts and not env:
        OVERRIDE.unlink(missing_ok=True)
        return ""
    lines = ["services:", "  api:"]
    if mounts:
        lines.append("    volumes:")
        lines += [f'      - "{m}:{m}:ro"' for m in mounts]
    if env:
        lines.append("    environment:")
        lines += [f'      - "{e}"' for e in env]
    OVERRIDE.parent.mkdir(exist_ok=True)
    OVERRIDE.write_text("\n".join(lines) + "\n")
    return f"-f {OVERRIDE}"


def emit_run(mounts: list[str], env: list[str]) -> str:
    return " ".join([f"-v {m}:{m}:ro" for m in mounts] + [f"-e {e}" for e in env])


def main() -> int:
    args = parse_args(sys.argv[1:])
    mounts = resolve_mounts(args.volume)
    env = resolve_env(args.env, mounted=bool(mounts))
    describe(mounts, env)
    print(
        emit_compose(mounts, env) if args.mode == "compose" else emit_run(mounts, env)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
