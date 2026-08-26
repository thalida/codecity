# `api/scan` — turning a repo on disk into a Manifest

`__init__.py` is the front door: everything in its `__all__` is called from
`routers/`, everything else is plumbing those entry points use.

Roughly the order a scan touches them:

| module          | job                                            |
| --------------- | ---------------------------------------------- |
| `skiprules.py`  | which paths the scanner is allowed to see      |
| `treebuild.py`  | the shared DFS builder every build path drives |
| `filemeta.py`   | per-file stat, line counts, binary sniffing    |
| `signatures.py` | the three fingerprints a manifest carries      |
| `stats.py`      | the pure per-repo aggregates                   |
| `manifest.py`   | the envelope wrapped around a built tree       |
| `scanner.py`    | the entry points                               |
| `timeline.py`   | the per-commit delta bundle                    |

This file holds what you need to know before changing any of it.

## Three build paths, one builder

The live scan, the single-ref reconstruction and the timeline union all drive
`treebuild.build_tree` through injected callables. That is not tidiness: it is
what makes their structure and layout signatures **byte-identical** for the same
tree. If you add a build path, drive the same loop, or a scrub will slide every
tree off its commit.

`build_file_node` is the one place a FileNode is assembled, so a new field is
added once and no path can silently omit it.

The walk is iterative, not recursive. Recursion blows the 1000-frame limit on
deeply nested trees — Java package hierarchies, generated protobuf, monorepos.

## The three signatures are a ladder

Each is a superset of the one before:

- `structure_signature` — paths and nesting only. Drives icon-atlas assignment
  and skeleton/final render stability.
- `layout_signature` — structure plus per-file size, i.e. exactly the layout
  packer's inputs, so the frontend reuses its packed layout iff this is
  unchanged.
- `content_signature` — structure, size, mtime, dirty, and repo HEAD. The full
  change-detection fingerprint: it drives the live-update poll and is the
  manifest cache key.

`signature_tree` and a full `scan_tree` push bytes through the **same** helpers.
That is what lets the cheap endpoint match a full scan exactly, so drift here
means every poll triggers a needless reload.

`dirty` rides along in the per-file hash because a mode-only edit flips it
without moving size or mtime, and a cached manifest would then serve a stale
flag.

## Stage order is chosen for what unblocks the UI

`scan_tree` yields three manifests: skeleton (real structure, placeholder
heights) so the client can paint and pack a layout; then per-file metadata for
real heights; then history last, which is by far the longest stage and only
decorations and the timeline read it.

Each yielded manifest is an independent snapshot — hence the deep copies. Don't
remove them to save the copy: consumers that hold an event across iterations
would then be reading a tree still being mutated.

## Only tracked files are scanned

Parents of tracked files are walked, but unstaged additions and gitignored paths
are skipped. `ALWAYS_SKIP` in `skiprules.py` is a second filter on top, for noise
someone committed on purpose.

What is deliberately **not** in `ALWAYS_SKIP`: generic names like `dist`,
`build`, `out`. They collide with real source directories — CMake configs, audio
stems, hand-written `dist/` trees. Framework caches (`.next`, `.nuxt`) are
unambiguous and stay. Lockfiles and vendored amalgamations (one 250k-line
`sqlite3.c`) are machine-generated, and a single one of them dominates every
height-based visual. Public headers like `sqlite3.h` are **not** skipped — they
may be authored.

`!` in a `.codecityignore` is the only way to override a default skip, and
`.git` ignores even that.

## Stats are computed once, and match the client exactly

`stats.py` is pure: one pass over files, one over dirs, one over commits, each
updating every winner and range for that pool as it goes rather than a separate
scan per superlative. First-seen wins ties, via strict `>` / `<`.

Two things there are easy to get wrong:

- The line/byte **ranges** are normalization ranges, not honest min/max. They
  cover files with non-zero values only, matching the client's `computeFileStats`
  exactly so the world renders identically, and because the frontend's log/sqrt
  can't take 0. The honest smallest file is in the `min*File` leaders.
- Media and binary files are their own categories and stay **out** of the code
  superlatives, so a giant `.db` never wins "widest building".

Directory age ties need care: every ancestor inherits its oldest descendant's
date, so a bare date comparison ties the whole chain and the shallowest wins by
iteration order. The tiebreak runs toward the deepest — the street that actually
holds the file, not each parent containing it.

## Timeline

One history walk becomes per-commit blob deltas the client replays for smooth
scrubbing. `walk_deltas` and the scan's history walk must produce the same commit
set in the same order, so index `i` lines up; there is an assert for it.

The union manifest gives each path its MAX size over history, and inherits
binary/media character from that largest-seen version. Its commits are
**uncapped**: the scrubber indexes the bundle's commits and the city the union
manifest's, so sampling one would slide every tree off its commit.

Pathological repos (union above `_UNION_FILE_CAP`) are windowed to their most
recent commits and say so in `note`.
