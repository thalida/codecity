# Sources

A source is a git repo, either a remote URL codecity clones or a path already on
disk. `sources.ts` classifies the string, decides its branch, and derives the
identity everything else keys on.

## Names come from the server

`label_from_source` runs once server-side and is baked into `tree.name` and the
`label` on progress events. There is no client-side URL→name transform, so a
repo is never called two different things in two places.

## A local source has no branch

It scans whatever is checked out, so a stored branch would be a lie: it must not
namespace the cache, the URL, or recents. `identityBranch` drops it at the commit
boundary, once, and everything downstream can then trust a local source is
branch-less without re-checking the kind on every read.

`resolveBranch` picks what to record for a remote: an explicitly requested branch
always wins, otherwise the manifest's resolved HEAD — but only when that names a
real branch. The server reports a detached HEAD as `(no branch)` or a name with
spaces, and those mean "no branch", not a branch called that.

## Identity is (src + identity branch)

Joined with a NUL, which can't appear in a path or URL, so the two halves can't
collide. That string is what recents dedupe on and what the active row matches;
its djb2 hash namespaces per-source state (selection, camera pose) in
localStorage.

## The field classifiers are about typing, not correctness

The source field takes a URL or a path in one input, and classifies as you type.
`srcKind` calls anything without `://` local, so `looksLikePath` exists to gate
the path-specific error to strings that are unmistakably paths — otherwise a URL
flickers "local path" until `://` lands. `looksResolvable` gates the branch
lookup to a complete URL for the same reason: every keystroke that parses would
otherwise be a request to the remote.
