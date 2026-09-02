#!/usr/bin/env python3
"""Find the architecture gaps that tests and typechecks cannot see.

Every class of bug below was found by hand in this repo, each time by noticing
something a machine could have noticed first. So this is that machine: it walks
every package and reports what LOOKS like each one, with the evidence, so a
reader can judge it rather than take a verdict.

It is deliberately not a gate. These are smells, and a smell can be the right
answer — a facade with one caller today is still a facade. Nothing here fails a
build; it produces a list to work through and re-run.

Usage: audit.py [--only CHECK] [--quiet] [PACKAGE...]

The checks, and the bug each one is looking for:

  dead          An export nothing in production calls. Test-only usage does not
                keep code alive: the feature was abandoned and the test now
                guards a thing no reader can reach.
  orphaned      An export whose last callers are a debug harness or itself —
                how a feature is lost while still compiling.
  misplaced     A module in one package that imports only from another. Logic
                that belongs in the package it is about, left in a consumer.
  vocabulary    An event emitted under a name that is not the emitter's own —
                a load reporting itself as a scan, so every host is told the
                wrong thing about what is happening.
  inference     A consumer deriving control flow from a *:progress event
                instead of asking for state. Sniffing traffic for a fact the
                producer knows and should say.
  owners        One value written from more than one module. Two owners of one
                fact is the shape most of this session's bugs took.
  composition   A component that others compose but no test ever renders. Every
                part correct, assembled wrong, and nothing catches it.
"""

from __future__ import annotations

import argparse
import ast
import collections
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ROOT / "packages"

TS = (".ts", ".tsx")
SKIP_DIRS = {"node_modules", ".venv", "dist", "build", "__pycache__", ".git"}

# A caller in one of these does not keep production code alive.
NON_PRODUCTION = ("/tests/", "/test_", "/capture/", ".test.", ".bench.", "conftest")

# Findings judged and kept, with the reason. A smell can be the right answer,
# and writing down WHY stops the next run re-arguing it. Keyed by file name.
JUDGED = {
    "client.ts": "resolves the Vite deploy base; a package cannot read its consumer's bundler",
    "params.ts": "the page URL is THIS app's contract; a host routing by path writes another",
    "keyboard.ts": "composes the city's own bindings with the app's, so one panel lists both",
    "dates.ts": "how a person READS a date is presentation; the parse rule is the package's",
    "loading.ts": "which rows this app's overlay lists; another host would list its own",
    "readout.ts": "what this app says about a city, which is not the city's to say",
    "useDocumentTitle.ts": "names the browser tab, which no embedded city owns",
    "NodeIcon.tsx": "this app's presentation of a node; the glyph mapping is the package's",
}


@dataclass
class Finding:
    check: str
    where: str
    what: str
    why: str
    evidence: list[str] = field(default_factory=list)


def sources(pkg: Path, suffixes: tuple[str, ...]) -> list[Path]:
    """Every source file in a package, tests included: a check that ignored
    tests could not tell test-only usage from none."""
    out: list[Path] = []
    for p in sorted(pkg.rglob("*")):
        if p.suffix in suffixes and not any(d in p.parts for d in SKIP_DIRS):
            out.append(p)
    return out


def is_production(path: Path) -> bool:
    s = str(path).replace("\\", "/")
    return not any(mark in s for mark in NON_PRODUCTION)


# ── TypeScript ───────────────────────────────────────────────────────
# Regex, not a parser: names and specifiers survive the imprecision.

EXPORT_RE = re.compile(
    r"^export\s+(?:async\s+)?(?:function|const|class|interface|enum|type)\s+(\w+)", re.M
)
IMPORT_RE = re.compile(r"from\s*['\"]([^'\"]+)['\"]")
EMIT_RE = re.compile(r"""emit\(\s*['"]([\w:]+)['"]""")
SUBSCRIBE_RE = re.compile(r"""\bon\(\s*['"]([\w:]+)['"]""")
SIGNAL_DECL_RE = re.compile(
    r"^export const ([A-Z][A-Z_0-9]*)\s*(?::[^=]+)?=\s*\w*signal", re.M
)


def ts_symbol_uses(files: dict[Path, str], name: str, home: Path) -> list[Path]:
    """Files other than its own that mention a symbol. A word boundary, so
    `CITY` does not match `CITY_STATUS`."""
    word = re.compile(rf"\b{re.escape(name)}\b")
    return [p for p, text in files.items() if p != home and word.search(text)]


def check_dead_and_orphaned(
    files: dict[Path, str], pkg: str, everywhere: dict[Path, str] | None = None
) -> list[Finding]:
    """An export nothing in production calls. Searched across EVERY package: a
    library's whole point is that its callers are somewhere else, and a check
    that looked only inside it would call its entire surface dead."""
    scope = everywhere or files
    out: list[Finding] = []
    for home, text in files.items():
        if not is_production(home):
            continue
        for name in EXPORT_RE.findall(text):
            users = ts_symbol_uses(scope, name, home)
            prod = [u for u in users if is_production(u)]
            if not users:
                continue  # a package's own public surface; the index check has it
            if not prod:
                out.append(
                    Finding(
                        "dead",
                        f"{pkg}/{home.name}",
                        name,
                        "only tests reach it: the feature is gone and the test guards nothing",
                        [str(u.name) for u in users[:3]],
                    )
                )
            elif all("capture" in str(u) for u in prod):
                out.append(
                    Finding(
                        "orphaned",
                        f"{pkg}/{home.name}",
                        name,
                        "its last production caller is a debug harness",
                        [str(u.name) for u in prod[:3]],
                    )
                )
    return out


def check_misplaced(
    files: dict[Path, str], pkg: str, siblings: set[str]
) -> list[Finding]:
    """A module whose every non-relative import is another package's. Whatever
    it knows, it knows about that package."""
    out: list[Finding] = []
    for path, text in files.items():
        if not is_production(path):
            continue
        specs = IMPORT_RE.findall(text)
        if not specs:
            continue
        local = [s for s in specs if s.startswith((".", "@/"))]
        external = [s for s in specs if not s.startswith((".", "@/"))]
        foreign = [
            s for s in external if any(s.startswith(f"@codecity/{o}") for o in siblings)
        ]
        framework = [
            s
            for s in external
            if s.split("/")[0] in {"preact", "@preact", "vitest", "three", "@tanstack"}
        ]
        if path.name in JUDGED:
            continue
        if foreign and not local and len(external) == len(foreign) + len(framework):
            out.append(
                Finding(
                    "misplaced",
                    f"{pkg}/{path.relative_to(path.parents[len(path.parts) - 1])}"
                    if False
                    else f"{pkg}/{path.name}",
                    path.stem,
                    f"imports only {sorted(set(foreign))[0]}: it is about that package",
                    sorted(set(foreign)),
                )
            )
    return out


def check_vocabulary(files: dict[Path, str], pkg: str) -> list[Finding]:
    """A module emitting under more than one namespace. Which namespace it
    picks is its own business — a source load calling itself `scan` is honest.
    Emitting under TWO is the bug: a timeline read that also emitted `scan:*`
    told every host it was scanning, and every host believed it."""
    out: list[Finding] = []
    for path, text in files.items():
        if not is_production(path) or path.stem in {"events", "index"}:
            continue
        spaces = collections.Counter(
            e.split(":", 1)[0] for e in EMIT_RE.findall(text) if ":" in e
        )
        if len(spaces) < 2:
            continue
        # The one it mostly is, and the ones it leaks under.
        main, _ = spaces.most_common(1)[0]
        other = sorted(ns for ns in spaces if ns != main)
        out.append(
            Finding(
                "vocabulary",
                f"{pkg}/{path.name}",
                ", ".join(f"{ns}:*" for ns in other),
                f"also reports as `{main}:*`; a host cannot tell which it is doing",
                sorted(f"{ns}×{n}" for ns, n in spaces.items()),
            )
        )
    return out


def check_inference(files: dict[Path, str], pkg: str, own: str) -> list[Finding]:
    """A consumer subscribing to a *:progress event. Progress is for drawing a
    number; deriving control flow from it is sniffing traffic for a fact the
    producer knows and could simply say."""
    out: list[Finding] = []
    for path, text in files.items():
        if not is_production(path) or pkg == own:
            continue
        for event in set(SUBSCRIBE_RE.findall(text)):
            if event.endswith(":progress"):
                out.append(
                    Finding(
                        "inference",
                        f"{pkg}/{path.name}",
                        event,
                        "reads a producer's progress traffic; ask its state instead",
                        [event],
                    )
                )
    return out


def check_owners(files: dict[Path, str], pkg: str) -> list[Finding]:
    """One value written from more than one module. Two owners of one fact is
    the shape most of this repo's state bugs have taken."""
    declared: dict[str, Path] = {}
    for path, text in files.items():
        if is_production(path):
            for name in SIGNAL_DECL_RE.findall(text):
                declared[name] = path
    out: list[Finding] = []
    for name, home in declared.items():
        writers = [
            p
            for p, text in files.items()
            if is_production(p) and re.search(rf"\b{re.escape(name)}\.value\s*=", text)
        ]
        if len(writers) > 1:
            out.append(
                Finding(
                    "owners",
                    f"{pkg}/{home.name}",
                    name,
                    f"written from {len(writers)} modules; one value wants one writer",
                    [p.name for p in writers[:4]],
                )
            )
    return out


def check_composition(files: dict[Path, str], pkg: str) -> list[Finding]:
    """A component others compose but no test ever renders. Each part can be
    covered and the assembly still be wrong — a footer above the city."""
    out: list[Finding] = []
    for path, text in files.items():
        if not is_production(path) or path.suffix != ".tsx":
            continue
        for name in EXPORT_RE.findall(text):
            if not name[0].isupper():
                continue
            tag = re.compile(rf"<{re.escape(name)}[\s/>]")
            composed = [
                p
                for p in files
                if p != path and is_production(p) and tag.search(files[p])
            ]
            rendered = [
                p for p in files if not is_production(p) and tag.search(files[p])
            ]
            if composed and not rendered:
                out.append(
                    Finding(
                        "composition",
                        f"{pkg}/{path.name}",
                        name,
                        f"composed by {len(composed)} modules, rendered by no test",
                        [p.name for p in composed[:3]],
                    )
                )
    return out


# ── Python ───────────────────────────────────────────────────────────


def check_python_dead(pkg: Path, name: str) -> list[Finding]:
    """Module-level defs nothing else imports or calls. Parsed rather than
    grepped: Python gives us a real tree for free."""
    files = [p for p in sources(pkg, (".py",))]
    texts = {p: p.read_text(encoding="utf8", errors="replace") for p in files}
    out: list[Finding] = []
    for path, text in texts.items():
        if not is_production(path):
            continue
        try:
            tree = ast.parse(text)
        except SyntaxError:
            continue
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if node.name.startswith("_"):
                continue  # private by convention: its module is the whole scope
            word = re.compile(rf"\b{re.escape(node.name)}\b")
            users = [p for p, t in texts.items() if p != path and word.search(t)]
            prod = [u for u in users if is_production(u)]
            # A helper its own module calls is alive: the definition is one
            # mention, so anything past that is a real use.
            if len(word.findall(text)) > 1:
                continue
            if users and not prod:
                out.append(
                    Finding(
                        "dead",
                        f"{name}/{path.name}",
                        node.name,
                        "only tests reach it",
                        [u.name for u in users[:3]],
                    )
                )
    return out


# ── What a good package looks like ───────────────────────────────────
# Not formatting: whether it can be USED, read from the source each run.


@dataclass
class Grade:
    name: str
    score: int
    outof: int
    note: str


def role_of(pkg: Path) -> str:
    """What this package is for. A library is consumed; an application is run;
    a service answers a wire. Grading one by another's criteria is noise."""
    if (pkg / "index.html").exists():
        return "application"
    if any((pkg / "src").rglob("*.ts")) if (pkg / "src").is_dir() else False:
        return "library"
    return "service"


def score_library(
    pkg: Path, name: str, files: dict[Path, str], everywhere
) -> list[Grade]:
    prod = {p: t for p, t in files.items() if is_production(p)}
    blob = "\n".join(prod.values())
    grades: list[Grade] = []

    def grade(title: str, ok: bool, note: str) -> None:
        grades.append(Grade(title, 1 if ok else 0, 1, note))

    # A consumer must be able to hold two. Anything at module scope that holds
    # per-instance state makes the second one overwrite the first.
    singletons = [
        (p.name, m)
        for p, t in prod.items()
        for m in SIGNAL_DECL_RE.findall(t)
        if "state" in str(p) or "store" in str(p)
    ]
    grade(
        "two instances can coexist",
        not singletons,
        "no module-scope instance state"
        if not singletons
        else f"{len(singletons)} module signals",
    )

    # What to show should be a value, not a call: props and arguments, not an
    # instance a consumer has to fish out and drive.
    entry = pkg / "src" / "index.ts"
    surface = (
        entry.read_text(encoding="utf8", errors="replace") if entry.exists() else ""
    )
    grade(
        "has a declared public surface",
        bool(surface),
        f"{surface.count('export')} exports from one entry"
        if surface
        else "no src/index.ts",
    )

    # It should say what it is doing in ONE vocabulary a consumer can render,
    # rather than leaving each one to fold its events.
    grade(
        "reports state, not just events",
        "CityStatus" in blob or "status" in blob.lower(),
        "a status a host can render off",
    )

    # A framework binding, if any, should be separable: the core is usable
    # without it, and a second framework is another folder rather than a fork.
    bindings = (
        [d.name for d in (pkg / "src").iterdir() if d.is_dir()]
        if (pkg / "src").is_dir()
        else []
    )
    fw = [b for b in bindings if b in {"preact", "react", "vue", "svelte"}]
    grade(
        "framework binding is separable",
        bool(fw) or not bindings,
        f"{fw[0]}/ beside a framework-free core" if fw else "no binding",
    )

    # A test kit is part of being usable: a consumer testing against it should
    # not have to rebuild the fixtures.
    grade(
        "ships a way to test against it",
        (pkg / "tests" / "index.ts").exists(),
        "a testing entry point",
    )

    # Nothing it exports should be reachable only from its own tests.
    dead = [
        f for f in check_dead_and_orphaned(files, name, everywhere) if f.check == "dead"
    ]
    grade("no test-only exports", not dead, f"{len(dead)} exports only tests reach")


    # Every piece it draws should be replaceable, and the defaults exported so a
    # host can wrap one rather than rebuild it.
    slots = re.search(r"interface \w*Components \{(.*?)\n\}", blob, re.S)
    members = len(re.findall(r"^\s+\w+\??:", slots.group(1), re.M)) if slots else 0
    defaults = len(re.findall(r"export (?:function|const) Default\w+", blob))
    grade(
        "its UI pieces are replaceable",
        members > 0 and defaults > 0,
        f"{members} slots, {defaults} defaults exported" if members else "no components map",
    )

    # A host should be able to add a whole part of its own, not just style one.
    grade(
        "takes extensions of its own",
        "Extension" in surface,
        "an extension type on the surface" if "Extension" in surface else "closed to additions",
    )

    # Put it back exactly: what it shows, how it is set up, where the reader is.
    grade(
        "can be snapshotted whole",
        "getSnapshot" in blob,
        "one call restores it" if "getSnapshot" in blob else "reassembled from separate calls",
    )

    # The first thing a stranger opens.
    readme = (pkg / "README.md").exists()
    grade("has a README", readme, "an entry point for a reader" if readme else "none")
    return grades


def score_application(
    pkg: Path, name: str, files: dict[Path, str], siblings: set[str]
) -> list[Grade]:
    """An application is graded on how it USES its libraries: whether it lets
    them own what they own, or keeps a second copy and drives them by hand."""
    prod = {p: t for p, t in files.items() if is_production(p)}
    blob = "\n".join(prod.values())
    grades: list[Grade] = []

    def grade(title: str, ok: bool, note: str) -> None:
        grades.append(Grade(title, 1 if ok else 0, 1, note))

    misplaced = check_misplaced(files, name, siblings)
    grade(
        "keeps no library's logic",
        not misplaced,
        f"{len(misplaced)} modules import only a library"
        if misplaced
        else "none found",
    )

    inference = check_inference(files, name, own="")
    grade(
        "asks state, not event traffic",
        not inference,
        f"{len(inference)} progress subscriptions" if inference else "none found",
    )

    owners = check_owners(files, name)
    grade(
        "one writer per value",
        not owners,
        f"{len(owners)} values written from several modules"
        if owners
        else "none found",
    )

    reaching = len(re.findall(r"\bcity\.(three|world|rig|picker)\.", blob))
    grade(
        "uses the surface, not the innards",
        reaching < 12,
        f"{reaching} reaches past the public API",
    )

    comp = check_composition(files, name)
    grade(
        "renders its compositions in tests",
        len(comp) < 8,
        f"{len(comp)} components no test assembles",
    )
    return grades


def score_service(pkg: Path, name: str) -> list[Grade]:
    """A service is graded on its wire: whether the contract is generated
    rather than hand-kept, whether the routes are thin, and whether a caller
    can be tested without one running."""
    grades: list[Grade] = []

    def grade(title: str, ok: bool, note: str) -> None:
        grades.append(Grade(title, 1 if ok else 0, 1, note))

    # A long FILE of small handlers is fine; one long handler is the fat one,
    # because everything it does is one thing nothing else can reach.
    fat: list[tuple[str, int]] = []
    for r in (r for r in sources(pkg, (".py",)) if r.parent.name == "routers"):
        try:
            tree = ast.parse(r.read_text(encoding="utf8", errors="replace"))
        except SyntaxError:
            continue
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                lines = (node.end_lineno or node.lineno) - node.lineno
                if lines > 60:
                    fat.append((f"{r.stem}.{node.name}", lines))
    grade(
        "routes are thin",
        not fat,
        "every handler delegates"
        if not fat
        else f"{len(fat)} over 60 lines: {max(fat, key=lambda f: f[1])[0]}",
    )

    generated = [p for p in sources(pkg, (".py",)) if p.name == "gen_openapi.py"]
    grade(
        "the wire contract is generated",
        bool(generated),
        "one schema, generated" if generated else "hand-kept types",
    )

    models = [p for p in sources(pkg, (".py",)) if p.parent.name == "models"]
    grade("the wire shapes are declared", bool(models), f"{len(models)} model modules")

    tests = [p for p in sources(pkg, (".py",)) if p.name.startswith("test_")]
    grade("has tests of its own", bool(tests), f"{len(tests)} test modules")

    # Named classes and a code enum, not a filename: a caller can only branch on
    # a failure it can name.
    named = set()
    for m in sources(pkg, (".py",)):
        if not is_production(m):
            continue
        try:
            tree = ast.parse(m.read_text(encoding="utf8", errors="replace"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and (
                node.name.endswith(("Error", "Exception")) or node.name.endswith("Code")
            ):
                named.add(node.name)
    grade(
        "failures are typed",
        len(named) >= 2,
        f"{len(named)} named: {', '.join(sorted(named)[:3])}"
        if named
        else "strings only",
    )
    return grades


def report_scores(names: list[str], everywhere: dict[Path, str]) -> None:
    print("\n══ package quality " + "═" * 44)
    print("  Each graded by what it IS: a library is consumed, an application")
    print("  is run, a service answers a wire.")
    for name in names:
        pkg = PACKAGES / name
        files = {
            p: p.read_text(encoding="utf8", errors="replace") for p in sources(pkg, TS)
        }
        role = role_of(pkg)
        if role == "service" or not files:
            grades = score_service(pkg, name)
            got = sum(g.score for g in grades)
            print(f"\n  {name} (service)  {got}/{len(grades)}")
            for g in grades:
                print(f"    {'yes' if g.score else 'NO '}  {g.name:32} {g.note}")
            continue
        siblings = {n for n in names if n != name}
        grades = (
            score_application(pkg, name, files, siblings)
            if role == "application"
            else score_library(pkg, name, files, everywhere)
        )
        got = sum(g.score for g in grades)
        print(f"\n  {name} ({role})  {got}/{len(grades)}")
        for g in grades:
            print(f"    {'yes' if g.score else 'NO '}  {g.name:32} {g.note}")


# ── Report ───────────────────────────────────────────────────────────

ORDER = [
    "dead",
    "orphaned",
    "misplaced",
    "vocabulary",
    "inference",
    "owners",
    "composition",
]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Architecture gaps, per package.")
    ap.add_argument("packages", nargs="*", help="package names; default is all of them")
    ap.add_argument("--only", choices=ORDER, help="run one check")
    ap.add_argument("--quiet", action="store_true", help="counts only")
    ap.add_argument(
        "--score", action="store_true", help="grade each package, not its gaps"
    )
    args = ap.parse_args(argv)

    names = args.packages or sorted(p.name for p in PACKAGES.iterdir() if p.is_dir())
    everywhere: dict[Path, str] = {}
    for n in names:
        for p in sources(PACKAGES / n, TS):
            everywhere[p] = p.read_text(encoding="utf8", errors="replace")

    if args.score:
        report_scores(names, everywhere)
        return 0
    findings: list[Finding] = []

    for name in names:
        pkg = PACKAGES / name
        if not pkg.is_dir():
            print(f"no such package: {name}", file=sys.stderr)
            return 2
        siblings = {n for n in names if n != name}

        ts_files = {
            p: p.read_text(encoding="utf8", errors="replace") for p in sources(pkg, TS)
        }
        if ts_files:
            findings += check_dead_and_orphaned(ts_files, name, everywhere)
            findings += check_misplaced(ts_files, name, siblings)
            findings += check_vocabulary(ts_files, name)
            findings += check_inference(ts_files, name, own="city")
            findings += check_owners(ts_files, name)
            findings += check_composition(ts_files, name)
        if any(sources(pkg, (".py",))):
            findings += check_python_dead(pkg, name)

    if args.only:
        findings = [f for f in findings if f.check == args.only]

    by_check = collections.defaultdict(list)
    for f in findings:
        by_check[f.check].append(f)

    for check in ORDER:
        found = by_check.get(check, [])
        if not found:
            continue
        print(f"\n── {check} ({len(found)}) " + "─" * max(0, 50 - len(check)))
        if args.quiet:
            continue
        for f in sorted(found, key=lambda f: f.where):
            print(f"  {f.where}: {f.what}")
            print(f"      {f.why}")
            if f.evidence:
                print(f"      seen in: {', '.join(f.evidence)}")

    print(f"\n{len(findings)} findings across {len(names)} packages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
