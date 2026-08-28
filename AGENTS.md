# Agent guide

Guidance for AI agents (and humans) working in this repo.

## Where the backlog lives

Open work is tracked in **GitHub Issues**, not in this repo. Don't keep a `TODO.md`.

```sh
gh issue list                          # everything open
gh issue list --label cat:bug          # just bugs
gh issue list --label P1               # highest priority
gh issue view <n>                      # full context for one item
```

Labels are namespaced. **Category:** `cat:bug`, `cat:enhancement`, `cat:documentation`,
`cat:security`. **Priority:** `P1`–`P4` (P1 highest). **Status:** `status:in-progress`,
`status:duplicate`, `status:wontfix`, `status:abandoned`. Plus `question`.

If you discover new work, file an issue rather than leaving an inline `TODO`.

## Working an issue

Start each issue in its own git worktree on a branch that GitHub links back to the
issue. Pick the branch prefix from the issue's `cat:` (category) label:

| Category label      | Prefix   |
| ------------------- | -------- |
| `cat:bug`           | `fix/`   |
| `cat:enhancement`   | `feat/`  |
| `cat:documentation` | `docs/`  |
| anything else       | `chore/` |

(Priority is a separate axis: `P1`–`P4` are priority tags, not types — pick the prefix from the `cat:` label.)

```sh
N=62                      # issue number
PREFIX=fix                # from the table above
SLUG=initial-frame        # 2-4 word kebab summary
BRANCH=$PREFIX/issue-$N-$SLUG

gh issue edit $N --add-assignee @me                 # assign it to yourself
gh issue develop $N --base main --name $BRANCH       # create the branch ON GitHub, linked in the issue's Development panel
git fetch origin
just worktree-setup $BRANCH                          # worktree at .claude/worktrees/${PREFIX}+issue-$N-$SLUG
cd .claude/worktrees/${PREFIX}+issue-$N-$SLUG && just setup
```

`gh issue develop` is what creates the real issue↔branch link (and a base for
`gh pr create`); plain `git worktree add -b` skips that link. Open the PR with
`Closes #N` so merging auto-closes the issue.

`just worktree-setup` carries over `.env.local` and `.claude/settings.json`: both
are gitignored, so a plain `git worktree add` leaves the new tree unconfigured.

**Never commit to `main`.** All work for an issue is committed on its worktree
branch — do every edit and `git commit` from inside the worktree, never in the
main checkout. Before each commit, confirm you're on the feature branch:

```sh
git branch --show-current    # must be your feat/fix/... branch, NOT main
```

A commit made in the main checkout is stranded off the branch: it never reaches
the PR, and it lingers on local `main` after the real work is squash-merged.

**Before opening a PR, check `main` is clean of stray commits:**

```sh
git fetch origin
git log --oneline origin/main..main    # must be EMPTY — nothing local-only on main
```

If that lists anything, a commit landed on `main` by mistake — move it to the
right branch (`git cherry-pick` onto the feature branch, then `git reset --hard
origin/main` on main) before continuing.

## Tearing down a merged issue

Once the PR is merged, clean up that issue's workspace: worktree, branch, and the
docker stack `just dev` spun up for it, volumes included. Skipping the volumes is
how you end up with dozens of `*_codecity-cache` and `*_codecity-test-*-cache`
orphans from branches that no longer exist.

```sh
just worktree-teardown fix/issue-61-image-tooltips   # from the main clone
```

That does the whole sequence: it refuses unless `gh pr list --state merged --head
$BRANCH` finds a merged PR, then removes the containers, the network, every volume
either project name owns, the worktree, and the branch (`-D`: a squash-merge looks
"unmerged" to `-d`), and prunes the remote head.

The two volume families use DIFFERENT project names: the dev cache keys off the
branch (`codecity-<branch-with-dashes>_`), the test caches off the worktree dir
basename with non-alphanumerics stripped (`fix+issue-61-foo` -> `fixissue-61-foo_`).
The recipe sweeps both by prefix rather than naming each volume, so a cache family
added later can't be left behind.

The merged-PR query is the authoritative "is it safe to delete" check — don't rely
on `git cherry origin/main $BRANCH`: a multi-commit branch squash-merges to a single
commit, so cherry reports every commit as `+` (not upstream) even though it's merged.

Name the network and volumes explicitly; do not reach for `docker network prune -f`
or `docker volume prune`. The global prune reaches beyond the torn-down issue: it
once deleted `codecity-main_default` while the main dev stack was mid-restart,
leaving those containers pointing at a gone network (`just dev` then fails with
"network ... not found"; recover with
`docker compose -p codecity-main -f docker-compose.dev.yml down`, then re-run).

## Layout

Everything the product is made of lives under `packages/`. `bin/` and
`.github/` are how it gets built and shipped; the split is what stops the two
kinds from interleaving alphabetically at the repo root.

Each package is independent: its own manifest, its own lockfile, its own
installed dependencies. Lifting one into a repo of its own is a copy, not a
untangling.

- `packages/app/` (`codecity`) and `packages/city/` (`@codecity/city`) — two
  separate npm projects, each with its own `package.json`, `package-lock.json`,
  `node_modules` and prettier.
  There is no npm project at the repo root, so nothing formats `README.md`,
  `AGENTS.md`, the compose files or the workflows: those belong to no package
  and are hand-formatted on purpose.
- `packages/city/` (`@codecity/city`) — the 3D renderer and the client every
  backend call goes through. `createCity(canvas)` is the whole entry point: hand
  it a canvas and an api base, and it fetches, builds, and reports what it is
  doing. It depends on `three`, `three-mesh-bvh` and `rbush`, and on nothing
  else — no Preact, no signals, no reactive runtime. Everything is per instance,
  so two cities on one page share no settings, selection, timeline or GPU
  resources; the landing's wallpaper and the `/city` scene are two such cities.
  - Values in, events out. The consumer owns settings values and pushes them
    with `updateSettings`; the city reports with `on(kind, listener)`. Layout
    runs in a worker under `src/layout/` (snapshot-tested — keep output
    identical).
  - `src/index.ts` is the public surface. `tests/index.ts` is a second one,
    `@codecity/city/testing`: the wire fixtures and stubs a consumer needs to
    test against a city. The renderer stubs sit behind
    `@codecity/city/testing/three` — a `vi.mock('three')` factory that awaits
    the main barrel deadlocks, because the barrel reaches source that imports
    three.
- `packages/app/` — Preact + TypeScript frontend. Two routes, one view each:
  `/` is the landing (pick a project) and `/city?src=…` is a world. The URL is
  the source of truth for both — `router/` owns it, and `?src`, `?mode`,
  `?commit` and `?sel` all survive Back and Forward.
  - This is where signals live. `state/stores/city.ts` is the seam: it holds the
    handle, mirrors the city's hover and selection onto app signals, and
    attaches the app's half of each event family (`attachCityChrome`,
    `attachBuildProgress`, `attachScanProgress`).
  - `src/state/` — stores under `stores/`, each named for the question it
    answers. `settings/` is its own subsystem: the city declares the fields and
    what each one costs, the app owns their values, persistence and signals.
  - `src/components/` — grouped by what a component is, not where it appears. A
    component used by exactly one thing lives beside that thing instead.
  - `tests/integration/` is the seam under test: the app driving a real city.
    Everything testing the city itself lives in `packages/city/tests/`.
- `packages/api/` — the Python project: `pyproject.toml`, `uv.lock`, and its own
  README and LICENSE (hatchling refuses paths outside the project directory).
  The importable package is `packages/api/api/`, because Python resolves
  `import api` by finding a directory named `api` and the manifest has to sit
  above the directory it names. FastAPI backend that walks the repo and serves
  the manifest. Layered, and imports only ever point down: `routers/` →
  `scan/` → `git/` and `cache/` → `models/`, `core/`, `utils/`.
  - `routers/` — the whole HTTP surface, one module per route family. `sse.py`
    is the streaming plumbing the two SSE routes share, not a route.
  - `git/`, `scan/` and `cache/` each curate a barrel in `__init__`.
    `api/tests/test_package_boundaries.py` fails if anything reaches past one.
  - `models/` — Pydantic, and the only definition of each shape. The scanner
    builds these directly, so there is no second copy to drift from.
  - `core/` is codecity-specific (config, security, progress); `utils/` is the
    part that would drop into another project unchanged.
  - `git/`, `scan/`, `routers/` and `models/` carry a README each. Read it
    before working in one.
- `.github/` — readme assets + CI workflows.

## Commands (run via `just`, not raw npm)

`just --list` is the source. The ones you'll want most: `just dev`, `just test`,
`just lint`, `just gen-types`. `just release` ships to production.
`just hero-image` recaptures the landing's fallback wallpaper from the showcase
pose, so the still and the live backdrop stay the same city.

## Conventions

- Comments explain non-obvious **why** only — no migration/historical narration.
  Capped at 2 lines (4 for a file header) in both languages, enforced at push.
  Longer guidance goes in the package's README, not a comment block.
- Single signal source-of-truth; explicit reactions, no implicit ordering deps.
- Commit incrementally at each green stop point; reference the issue you're closing.
