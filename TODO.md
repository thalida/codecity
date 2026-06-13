# ToDo

- [x] make building height <> num lines (floor is set # of lines)
- [x] threejs
- [x] interactive streets
- [x] labels on hover
- [x] billboard media files
- [x] treeview interact with scene rendering
- [x] building / rendering data in sidebar
- [x] clean up blocks and hitTestBlock
- [x] rounded street ends
- [x] rename .dev to build or dist
- [x] Update README.md
- [x] Add typescript
- [x] Add about panel if project root has a readme
- [-] "flash" buildings that are updating because of a change
- [x] make windows more irregular / dynamic
- [x] make buildings go on either side of the street
- [x] make fitting the side streets account for their irregular shape
- [x] in left of footer add live reload status
- [x] move file/directory information to right of footer
- [x] include repo information in center of footer
- [x] add file icon type to sidebar
- [x] add file icon to the roof of buildings
- [x] display images and videos as billboards
- [-] identify and add something special to test files
- [x] python cli make it more professional
- [x] add back gitignore flag -- make it a user facing config option
- [-] allow clicking on a file in file tree to deselect it
- [ ] fix building focus with the new compact mode
- [x] fix loading by git url via cmd line
- [x] add ability to set path in ui
- [x] make controls tab more compact
- [-] change the info panel to be about codecity not the repo readme
- [x] fix alignment in file tree
- [x] don't select when rotating the world
- [x] media billboards as buildings w/ ads (width by file size and height by dimensions? duration?) same age / window considerations
- [ ] Make Save commits cheaper for layout-affecting controls (currently every Save invalidates the layout cache → full worker recompute). Combined with the layoutV4 perf cost below, a Save on a Linux-kernel-scale repo blocks ~80s. Possible directions: debounce on commit, threshold-skip when N_files > X, or a partial-rebuild path.
- [x] Favicon & Meta
- [-] Cache Invalidation
- [ ] CodeCity Guide
- [ ] CodeCity Docs
- [x] Update Readme
- [x] on focus / select look straight down at the building
- [ ] add meta data about the world
- [x] add enable local env variable
- [x] fix start position to include tallest building
- [x] support empty git repos (unborn HEAD → empty world, not a cryptic git error)
- [x] no-project-loaded UX: lazy-render header chip, collapse sidebar, explorer + info empty-state cards
- [x] camera framing accounts for the floating repo-label panel (especially on empty worlds)
- [x] forge-aware repo link: external-link button deep-links to the active branch on github / gitlab / bitbucket / codeberg / forgejo / gitea / sr.ht
- [x] drop the history-window picker option + the whole `git_window` / `CODECITY_GIT_WINDOW` plumbing
- [ ] mount-path detection / autocomplete — let the server expose which `-v` paths are mounted so the Local pane can autocomplete + validate. `CODECITY_LOCAL_PATHS` env (set by `just dev/run` alongside `-v`) with `/proc/self/mounts` fallback for raw `docker run` users. Sketched in the conditional-local-repos spec's Follow-up section.
- [x] per-author fireflies + co-author support — today each commit places 1 firefly (`ORBS_PER_TREE = 1`) and `commit.author` is a single string. Change so each distinct author of a commit gets their own firefly on that commit's tree, the api parses `Co-authored-by:` trailers, and the sidebar commit pane lists every author. Detailed prompt below.
- [x] commit-info side pane perf — selecting a tree currently shows "Loading commit…" for a noticeable beat before the commit details render. Profile what's happening on the server + client (commit fetch endpoint, JSON parse, sidebar render) and tighten it; pre-fetching on hover or caching the last N commits client-side are likely directions.
- [x] (QA) `/api/manifest/signature` returned 400 on the live-update poll for git URLs (nanostores@main, repeating 4×) — the poll fired mid-clone, before `resolve_source` could resolve, once per tick during the clone window. Fixed by the live-update poll rework (commit 20c9d1cc): `tick()` now bails unless the foreground load is done (`SCAN_PROGRESS` null) AND a source actually committed (`CURRENT_SOURCE` set on load success) AND the manifest is non-empty — so the poll can't probe a source that's still cloning.
- [ ] hover visual glitch — hovering a building shows a faint lighter-tinted duplicate offset to the lower-left (a ghost/double-image, not a symmetric halo). The hover overlay is a translucent box (`city/components/buildings/ghost.ts`, scaled 1.005× + instance-color mirror) + a `LineSegments2` outline; investigate whether the offset comes from a stale/mismatched instance matrix, the ghost transform, or the bloom/composer. Root-cause before fixing.
- [x] grime streaks scale by building age — Intensity and Coverage are now RangePair `[newest, oldest]` settings; the shader lerps each per-building by createdAge.
- [x] building tilt scales by building age — TILT_DEGREES is now a RangePair `[newest, oldest]`; shader + CPU (outline/picker) lerp the lean by createdAge.

## Agent Prompts ToDos

### Optimize the layoutV4 worker (~70-80s Linux cold-load cost)

```text
The cell-rendering branch (feat/large-repo-rendering) reduced Linux load time from ~6 min to ~90s, but ~80s of that is now inside _layoutClient.compute — i.e. the layout worker (app/scene/layoutWorker.ts → app/scene/layoutV4.ts). The rendering side is no longer the bottleneck; the layout algorithm itself is. Profile it on the Linux kernel (torvalds/linux.git, ~93k files / ~5k directories) and identify the hottest section.

Suspect O(N²) loops in street collision detection or building rasterization (layoutV4 is ~920 lines with hierarchical street/stem placement). Don't touch the OUTPUT (positions, dimensions) — keep the algorithm's results bit-identical against the existing snapshot tests in app/tests/scene/layoutV4.test.ts and app/tests/scene/layoutV4-trace.test.ts. Only change implementation. The layout cache wrapper in app/scene/layoutClient.ts is fine as-is.

Start by adding a single perf log inside layoutV4.ts that breaks down time per phase (tree walk / street placement / collision check / building dimension assignment / etc.) so we know what's actually slow before changing anything. Then bring me the perf breakdown and a proposed approach before refactoring.

Note: the controls-cleanup PR (#39) made this path hotter — Save commits on layout-affecting Controls now force-invalidate the layout cache (commit 5abea57), so every Save on a large repo pays the full recompute cost. The fix was correct (Saves used to do nothing for these stores), but the perf bottleneck below is now user-facing on Save, not just on initial load.
```
