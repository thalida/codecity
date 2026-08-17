# `api/models` — the shapes that cross a boundary

| module         | what it is                                             |
| -------------- | ------------------------------------------------------ |
| `manifest.py`  | the domain data, read and written by every layer       |
| `events.py`    | the `data:` bodies of the SSE events — HTTP layer only |
| `responses.py` | the JSON bodies of the plain routes — HTTP layer only  |

Import from the submodule. `manifest` sits at the bottom of the layering while
the other two belong to the HTTP layer, and a barrel flattening the three would
hide exactly that difference.

Event **names** and error codes aren't here: they are wire vocabulary the
scanner and git layers speak too, so they live in `api/core/constants.py`.

## One definition, not two

`manifest.py` is what the scanner builds, what the caches persist, what the SSE
stream serialises, and what the OpenAPI schema — and from it
`app/src/types/manifest.generated.ts` — is generated from. There is no second
declaration of these shapes to keep in step.

That was not always true. A parallel set of TypedDicts existed for the scanner,
kept aligned by hand, and it drifted: `RepoStats` was four fields behind for
long enough to ship. If you are tempted to add a fast path that redeclares one
of these shapes, that is the outcome to expect.

After a change here, run `just gen-types`. `just check-types-fresh` fails the
build otherwise, and pre-push runs it as step 7.

The committed `manifest.generated.ts` is raw openapi-typescript output and is
prettierignored. Formatting it makes that diff report the formatting instead of
the models, which is what it is there to catch.

## Two kinds of optional, and they are not interchangeable

**Required-nullable** — the field is always present, sometimes `null`. Written
`Optional[str]` with no default. `RepoInfo.branch` is one: the scanner always
emits it, and it is `null` for a repo with no HEAD.

**Optional-but-non-nullable** — the field may be absent, but is never `null`
when present. Written with the `OptionalInt` / `OptionalStr` aliases, which keep
the Python type `Optional` (so the default is `None` and validators can check
it) while emitting the bare non-nullable type into the JSON schema. That
matches the true wire, and it is why the SSE serialiser drops `None` values
rather than sending them: a progress line with no object count must not ship
`"objects": null` for the client to special-case.

Getting this wrong doesn't fail anywhere in Python. It changes the generated TS,
and the frontend then guards for a null that never arrives, or fails to guard
for an absence that does.

## Media dimensions are a pair

`media_width` and `media_height` are both present or both absent, enforced by a
validator on every model that carries them. Half a pair would size a building
against a dimension it doesn't have. The caches enforce the same rule on their
own record shapes — see `api/cache/entries.py`.

## The three signatures

`Manifest` carries three, each a superset of the one before: `structure`
(paths and nesting), `layout` (structure plus per-file size — exactly the layout
packer's inputs), and `content` (plus size, mtime, dirty and repo HEAD). What
computes them, and why they must agree byte for byte across build paths, is in
`api/scan/README.md`.
