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

| Category label      | Prefix  |
| ------------------- | ------- |
| `cat:bug`           | `fix/`  |
| `cat:enhancement`   | `feat/` |
| `cat:documentation` | `docs/` |
| anything else       | `chore/`|

(Priority is a separate axis: `P1`–`P4` are priority tags, not types — pick the prefix from the `cat:` label.)

```sh
N=62                      # issue number
PREFIX=fix                # from the table above
SLUG=initial-frame        # 2-4 word kebab summary
BRANCH=$PREFIX/issue-$N-$SLUG

gh issue edit $N --add-assignee @me                 # assign it to yourself
gh issue develop $N --base main --name $BRANCH       # create the branch ON GitHub, linked in the issue's Development panel
git fetch origin
git worktree add .claude/worktrees/${PREFIX}+issue-$N-$SLUG $BRANCH
```

`gh issue develop` is what creates the real issue↔branch link (and a base for
`gh pr create`); plain `git worktree add -b` skips that link. Open the PR with
`Closes #N` so merging auto-closes the issue.

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

Once the PR is merged, clean up that issue's workspace — worktree, branches, and
the docker stack `just dev` spun up for it.

```sh
N=61; BRANCH=fix/issue-$N-image-tooltips          # the issue's branch

# 1. confirm it actually merged before deleting anything
gh issue view $N --json state -q .state                              # CLOSED
gh pr list --state merged --head $BRANCH --json number,mergedAt      # the authoritative check

# 2. docker: containers are named codecity-<branch-with-dashes>-{app,api}-1
docker rm -f $(docker ps -aq --filter "name=codecity-${BRANCH//\//-}")
docker network rm codecity-${BRANCH//\//-}_default 2>/dev/null || true   # THIS issue's network only

# 3. worktree + branches
git worktree remove .claude/worktrees/fix+issue-$N-image-tooltips
git branch -D $BRANCH                               # -D: squash-merges look "unmerged" to -d
git remote prune origin                             # remote head is usually auto-deleted on merge
```

The merged-PR query is the authoritative "is it safe to delete" check — don't rely
on `git cherry origin/main $BRANCH`: a multi-commit branch squash-merges to a single
commit, so cherry reports every commit as `+` (not upstream) even though it's merged.

Remove **only this issue's** network — do NOT run `docker network prune -f`. The
global prune reaches beyond the torn-down issue: it once deleted `codecity-main_default`
while the main dev stack was mid-restart, leaving those containers pointing at a gone
network (`just dev` then fails with "network ... not found"; recover with
`docker compose -p codecity-main -f docker-compose.dev.yml down`, then re-run).

## Layout

- `app/` — Preact + TypeScript frontend; the 3D city lives in `app/city/` (a
  signals-driven mini-app: `state/ components/ render/ types/ constants/ utils/`).
  Layout worker is `app/scene/layoutV4.ts` (snapshot-tested — keep output bit-identical).
- `api/` — FastAPI backend that walks the repo and serves the manifest.
- `.github/` — readme assets + CI workflows.

## Commands (run via `just`, not raw npm)

```sh
just dev          # run the dev stack
just test         # test-api + test-app
just lint         # fmt-check + lint
just fmt          # auto-format
just gen-types    # regenerate frontend types from the backend (contract guard)
just build        # production image
```

## Conventions

- Comments explain non-obvious **why** only — no migration/historical narration.
- Single signal source-of-truth; explicit reactions, no implicit ordering deps.
- Commit incrementally at each green stop point; reference the issue you're closing.
