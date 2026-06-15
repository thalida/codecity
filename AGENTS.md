# Agent guide

Guidance for AI agents (and humans) working in this repo.

## Where the backlog lives

Open work is tracked in **GitHub Issues**, not in this repo. Don't keep a `TODO.md`.

```sh
gh issue list                          # everything open
gh issue list --label bug              # just bugs
gh issue list --label nice-to-have     # deferred-but-real, lower priority
gh issue view <n>                      # full context for one item
```

Labels: `bug`, `enhancement`, `documentation`, `nice-to-have` (deferred / not urgent),
`question`, `wontfix`, `duplicate`, `invalid`.

If you discover new work, file an issue rather than leaving an inline `TODO`.

## Working an issue

Start each issue in its own git worktree on a branch that GitHub links back to the
issue. Pick the branch prefix from the issue's primary type label:

| Label           | Prefix  |
| --------------- | ------- |
| `bug`           | `fix/`  |
| `enhancement`   | `feat/` |
| `documentation` | `docs/` |
| anything else   | `chore/`|

(`nice-to-have` is a priority tag, not a type — use the type label underneath it.)

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

## Tearing down a merged issue

Once the PR is merged, clean up that issue's workspace — worktree, branches, and
the docker stack `just dev` spun up for it.

```sh
N=61; BRANCH=fix/issue-$N-image-tooltips          # the issue's branch

# 1. confirm it actually merged before deleting anything
gh issue view $N --json state -q .state            # CLOSED
git fetch origin main && git cherry origin/main $BRANCH   # all lines prefixed "-" = upstream

# 2. docker: containers are named codecity-<branch-with-dashes>-{app,api}-1
docker rm -f $(docker ps -aq --filter "name=codecity-${BRANCH//\//-}")
docker network prune -f                            # only removes empty networks; running stacks are safe

# 3. worktree + branches
git worktree remove .claude/worktrees/fix+issue-$N-image-tooltips
git branch -D $BRANCH                               # -D: squash-merges look "unmerged" to -d
git remote prune origin                             # remote head is usually auto-deleted on merge
```

`docker network prune` also clears other stale empty networks from old branches —
harmless, but scope it with `docker network rm codecity-${BRANCH//\//-}_default` if
you want to touch only this issue's network.

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
