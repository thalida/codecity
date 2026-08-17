# api/cache

Everything codecity keeps on disk so it doesn't recompute it. Nothing here is a
source of truth. A miss costs time; it can never cost correctness.

That single rule is what licenses the rest of the package's behaviour: reads
return empty or `None` on any problem instead of raising, a failed write is
swallowed rather than propagated, and retention evicts without asking anyone.

## The layout

    storage/   how anything reaches disk and comes back
    content/   per-file facts, cached under two different identities
    results/   whole-repo outputs, replaced wholesale rather than merged

`api/cache/__init__.py` is the front door. Outside this package, import from
`api.cache` and nothing else — `api/tests/test_package_boundaries.py` fails the
build otherwise. Inside it, import the module you need by name; the sub-packages
deliberately have no barrels of their own.

## File vs blob, which is the whole design

A **file** is a path in the working tree. It has a name, a location and an
mtime, and its content changes underneath it.

A **blob** is git's storage for the bytes of one version of one file. Its name
_is_ the hash of its contents. It has no path and no date, and it can never
change — editing a file doesn't modify a blob, it makes a new one.

So one blob can back many files (two identical `LICENSE` files are one blob),
and one file is many blobs over its history.

That gives the two content caches opposite invalidation rules:

|            | `content/files`       | `content/blobs`              |
| ---------- | --------------------- | ---------------------------- |
| key        | path                  | blob sha                     |
| read from  | the working tree      | the git object database      |
| stale when | `(size, mtime)` moves | never                        |
| built by   | the live scan         | ref reconstruction, timeline |

**Do not try to unify them.** Keying the live scan by sha would mean hashing
every file in the working tree to learn its sha — a full read of the repo,
which is exactly what the `(size, mtime)` key exists to avoid. The asymmetry is
the optimisation.

They store the same _facts_ (lines, binary, media dims, binary type), which is
why the record shape lives once in `content/entries.py` and not twice.

## Adding a cache

Pick the key first, because it decides everything else:

- **Content-addressed** (a sha) — never needs invalidating. Prefer this.
- **State-addressed** (a content signature, a HEAD) — invalidates when the
  state moves. Fold every input into the key, or you will serve a hit that
  answers a different question. `timeline_cache_path` folds in the user's
  excludes for exactly this reason.
- **Path-addressed** — needs an explicit staleness check stored alongside.

Then:

- Give it a `VERSION`, and bump it whenever the stored shape changes. Stale
  blobs then miss and rebuild instead of deserialising into the wrong thing.
- Go through `storage/store.py` for the read and the write. It owns atomic
  writes and the tolerate-garbage rule at both envelope and field level.
- Go through `storage/paths.py` for the filename. Nothing else may read
  `CACHE_ROOT`, which is what lets one fixture redirect the whole package.
- **Always write, even when `use_cache` is false.** That flag gates the READ.
  A no-cache scan still leaves a warm cache behind.
- Union-merge on save where entries are per-file, so a `.codecityignore` edit
  doesn't throw away everything it happened to hide this run.

## Retention

`results/manifests.py` sweeps on every save, per repo, per family, oldest-first
by mtime. Uncapped it reached 844 files / 281 MB on one dev machine.

The just-written entry is passed as `protect` and never counted: mtime has
one-second resolution, so a burst of saves can tie and sort the new entry into
the tail. Ordering is by mtime rather than atime because `relatime` doesn't
reliably track reads — a much-read old signature still ages out.

The per-family caps are counts, not bytes, so total disk use varies with what
the repo looks like. Worth revisiting if it starts to matter.
