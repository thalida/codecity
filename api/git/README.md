# `api/git` — everything that shells out to git

Five modules. `__init__.py` is the front door for `routers/`; `scan/` reaches
past it into the submodules directly, which is allowed but means the barrel is
a contract with the HTTP layer only.

| module       | job                                                      |
| ------------ | -------------------------------------------------------- |
| `cmd.py`     | how a git command against a local repo is invoked        |
| `source.py`  | what a `?src=` string is, and where it resolves on disk  |
| `clone.py`   | fetching and updating a remote into the local cache      |
| `objects.py` | the object database — `ls-tree`, `cat-file`, `rev-parse` |
| `meta.py`    | history walks, working-tree state, the repo footer       |

This file holds the context that doesn't fit in a two-line comment but that you
need before changing anything here. The rules the code enforces live in the
code; the reasons they exist live here.

## `safe.directory=*` is not optional

Every read of a local repo goes through `cmd.git_argv`, which sets it. Git 2.35+
refuses a repo whose owner isn't the process uid, and in the container that is
**every** bind-mounted repo: the process runs as uid 10001, and nothing mounted
from the host is owned by it.

The failure is quiet and misleading. Git exits non-zero with "dubious
ownership", and the caller reads that as "not a repo" — which is how
`_is_git_working_tree` once told people to run `git init` inside a perfectly
good repo. If you add a git invocation, route it through `git_argv`.

Talking to a **remote** is a different job with different needs (credential
prompts disabled, no `-C`, streamed progress) and lives in `clone.py`, which has
its own `_run_git`.

## Clones are blobless, and that has consequences

`ensure_clone` uses `--filter=blob:none`. Every commit and tree is kept, so
per-file dates survive; only historical file _content_ is skipped, which the
live scan never reads.

The timeline does read it. So before a timeline build, `hydrate_blobs` widens
the filter and refetches in one packfile. Doing it lazily instead means git
fetches each missing blob on demand — thousands of round trips, minutes of
apparent hang. `GIT_NO_LAZY_FETCH=1` in `objects.py` is the backstop: a blob
that is still missing reads as 0 lines rather than triggering that.

## Clones are evicted at startup, and only then

`clones/` has its own byte budget (`CODECITY_CLONE_BUDGET_MB`), separate from
the derived caches: evicting a manifest costs a re-read, evicting an 8GB clone
costs minutes and a network round trip.

The sweep runs in the app's lifespan startup and nowhere else. `scan_tree` walks
a clone directory for the whole duration of a scan, and nothing tracks which
clones are being read — `_CLONE_LOCK` answers "is anyone cloning", not "is
anyone using this one". Before the server accepts a request, that question
cannot arise, which is cheaper than any machinery that could answer it.

Order is least-recently-USED, recorded rather than inferred: `ensure_clone`
stamps `.git/codecity-usage.json` on its way out, so the timestamp means a scan
was handed this clone. Directory mtime would not — a fetch that finds nothing
new may not touch the top level, and one that does says nothing about a city
ever being rendered. A clone with no record sorts as never used, biggest first.

## Serving a request never downloads

`read_blob` backs `GET /api/file`, so it reads only what is already on disk: no
promisor fetch (`GIT_NO_LAZY_FETCH`), and no `git lfs smudge`, which downloads
the object from the LFS endpoint. One preview pane is one such fetch; a media
repo mid-scan is a page of them at once, on request threads, against an endpoint
that blocks bursts. Downloading belongs to `_pull_lfs`, `fetch_lfs_history` and
`blob_stats_batch` — bulk, once, off the request path.

What a request can't serve comes back as `BlobUnavailable.PENDING`, which the
router answers with `202 Accepted` rather than `404`: the content isn't gone,
this machine just doesn't have it yet, and a burst of 404s from one client is
what gets that client blocked.

`_HYDRATED_MARKER` is written only after the refetch lands. The widened filter
can't stand in for it, because the filter has to be in place _before_ the
refetch — so a cancel or a network drop mid-fetch would leave a clone that
looks hydrated with its history still missing, and every later timeline would
read those blobs as 0 lines, 0 bytes.

## Large clones fail in specific ways, and the code is shaped around them

- GitHub's HTTP/2 multiplexing intermittently RSTs the pack transfer on very
  large repos (`curl 92 … CANCEL` → "early EOF"). Retries drop to HTTP/1.1,
  which rides it out at equivalent throughput for a one-pack clone. First
  attempts stay on git's default, so ordinary clones keep multiplexing.
- git ends a clone or fetch with a **detached** `maintenance run --auto` that
  keeps writing into the repo afterwards, racing whoever reads or deletes it
  next. `_NO_AUTO_MAINTENANCE` turns it off.
- `git clone` exits 0 when it can't resolve the remote's HEAD: it parks HEAD on
  a dangling ref and checks nothing out, so the repo scans as zero files with
  no error. `_ensure_checkout` is what catches that.
- `reset --hard` moves whatever HEAD points at rather than repointing HEAD, so
  a dangling HEAD survives it — the tree fills but every history command still
  fails. Put HEAD on a branch first.

Only network drops retry. Auth failures and not-found re-raise on the first
attempt, because retrying them just makes the user wait longer for the same
answer.

## Error taxonomy

`clone.py` translates git's stderr into `CloneError` subclasses so routes can
return a clean 4xx instead of raw git output. Two deliberate choices:

- A host that demands credentials is reported as **not found**, not as
  forbidden. The server has no credentials by design, so it genuinely cannot
  tell a private repo from a typo, and saying "private" would be a guess.
- A URL that reaches a server which isn't serving a git repo gets its own
  message, because the usual cause is a copied web page URL with an `#anchor`,
  `?query` or `/tree/<branch>` still on the end — and the fix is to remove that,
  not to check the spelling.

## Reading history

`meta._walk_git_log` does one newest→oldest `--name-status` pass and takes the
first sighting of each path. That is what makes a single pass enough.

`--no-renames` records a rename as delete+add, so `created` is when the _current
path_ appeared. That is the right semantic here: the user sees a building for a
path, not for a file identity.

Merges are diffed `--diff-merges=first-parent` so a merge still reports a file
count, but their A/M events are skipped — otherwise a subtree merge re-adds its
files and stamps the merge date over every real creation date.

Old commits carry Latin-1 author bytes (torvalds/linux does), so the stream is
decoded with `errors="replace"`. Strict decoding raises mid-stream and deadlocks
the drain.

## Subprocess hygiene

Kill before wait. If git is mid-write with a full stdout pipe, `wait()` alone
deadlocks: git can't exit until the pipe drains, and nothing is draining it.
Both streaming readers here do `proc.kill()` then `proc.wait()` in a `finally`.
