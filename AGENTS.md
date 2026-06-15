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

Pick up an issue, open a branch, and reference it in the PR (`Closes #n`). If you
discover new work, file an issue rather than leaving an inline `TODO`.

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
