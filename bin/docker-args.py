#!/usr/bin/env python3
"""Turn `.env.local` plus the arguments of `just dev` / `just run` into docker
config.

Usage: docker-args.py (compose|run) [-v PATH ...] [-e NAME=VALUE ...]

Two layers, both optional:

`.env.local` (gitignored, seeded from .env.local.example by `just setup`) holds
your standing setup, so `just dev` alone starts the way you usually want it:

    CODECITY_MOUNT=~/Documents/Repos          # comma-separated for several
    CODECITY_HOSTED=1

Only CODECITY_* keys are forwarded, and blank ones are skipped so the template
can list every var without setting any. The same file carries deploy
credentials for `just deploy`, and those must not reach the api container.

Flags handle the one-off, and are docker's own since a mount and an env var are
both docker concepts:

    just dev -v ~/Documents/Repos/myproj -e CODECITY_DISCOVER=off

-v adds to the file's mounts; -e replaces the file's value for that name. So
the file is where the defaults live and a flag is how you deviate for one run.

-v takes a bare path rather than docker's SRC:DST:MODE because codecity
supports exactly one mount shape: read-only at the same absolute path, so a
path the browser hands the api resolves to the same file inside the container.

Any mount implies CODECITY_ALLOW_LOCAL_REPOS=1, which an explicit value from
either layer replaces, so `-e CODECITY_ALLOW_LOCAL_REPOS=0` still turns it off.

`compose` writes .local/dev.override.yml and prints the `-f` flag pointing at
it; `run` prints `-v`/`-e` flags for `docker run`. Both print nothing when
there is nothing to pass, and describe what they did on stderr. Output is
shell-interpolated unquoted by the recipes, so paths containing spaces are
not supported.
"""

import argparse
import pathlib
import re
import sys

ENV_FILE = pathlib.Path(".env.local")
OVERRIDE = pathlib.Path(".local/dev.override.yml")

# .env.local also holds deploy credentials, which have no business inside the
# api container, so only the api's own namespace is forwarded.
CONTAINER_PREFIX = "CODECITY_"

# Mounts are declared in the same file for convenience, but they configure the
# container rather than the api, so this key is consumed here, not passed on.
MOUNT_KEY = "CODECITY_MOUNT"

ENV_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

# Stamped on the override so the file explains itself when someone opens it:
# it is compiled output, and the two places worth editing are named.
OVERRIDE_HEADER = [
    "# GENERATED FILE, do not edit.",
    "#",
    f"# Written by bin/docker-args.py on every `just dev`, from {ENV_FILE} plus",
    "# any -v / -e flags on the command line. Rewritten from scratch each run,",
    "# and deleted when there is nothing to pass, so edits here do not survive.",
    "#",
    f"# To change what it contains, edit {ENV_FILE}:",
    "#     CODECITY_MOUNT=~/Documents/Repos",
    "#     CODECITY_HOSTED=1",
    "# or pass it for a single run:",
    "#     just dev -v ~/Documents/Repos -e CODECITY_HOSTED=1",
    "",
]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="docker-args.py",
        description="Build docker config from .env.local and `just dev` arguments.",
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


def read_env_file() -> dict[str, str]:
    """Parse .env.local: NAME=VALUE per line, `#` comments and blanks skipped,
    one layer of surrounding quotes stripped. Missing file is not an error."""
    if not ENV_FILE.exists():
        return {}
    values: dict[str, str] = {}
    for number, line in enumerate(ENV_FILE.read_text().splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not ENV_ASSIGNMENT.match(stripped):
            raise SystemExit(f"error: {ENV_FILE}:{number}: expected NAME=VALUE")
        name, value = stripped.split("=", 1)
        values[name] = value.strip().strip("\"'")
    return values


def resolve_mounts(paths: list[str]) -> list[str]:
    """Absolute, de-duplicated, in the order given."""
    mounts: list[str] = []
    for raw in paths:
        path = pathlib.Path(raw).expanduser()
        if not path.is_dir():
            hint = " (env vars go in -e)" if ENV_ASSIGNMENT.match(raw) else ""
            raise SystemExit(f"error: {raw!r} is not a directory{hint}")
        resolved = str(path.resolve())
        if resolved not in mounts:
            mounts.append(resolved)
    return mounts


def resolve_env(
    assignments: list[str], base: dict[str, str], mounted: bool
) -> list[str]:
    # Keyed by name so a repeated var resolves here rather than relying on
    # whether docker takes the first or the last of a duplicate.
    env = dict(base)
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
    lines = [*OVERRIDE_HEADER, "services:", "  api:"]
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
    from_file = read_env_file()
    declared = from_file.pop(MOUNT_KEY, "")
    mounts = resolve_mounts(
        [p.strip() for p in declared.split(",") if p.strip()] + args.volume
    )
    base = {
        k: v for k, v in from_file.items() if k.startswith(CONTAINER_PREFIX) and v != ""
    }
    env = resolve_env(args.env, base, mounted=bool(mounts))
    describe(mounts, env)
    print(
        emit_compose(mounts, env) if args.mode == "compose" else emit_run(mounts, env)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
