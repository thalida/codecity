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

## Agent Prompts ToDos

### Optimize the layoutV4 worker (~70-80s Linux cold-load cost)

```text
The cell-rendering branch (feat/large-repo-rendering) reduced Linux load time from ~6 min to ~90s, but ~80s of that is now inside _layoutClient.compute — i.e. the layout worker (app/scene/layoutWorker.ts → app/scene/layoutV4.ts). The rendering side is no longer the bottleneck; the layout algorithm itself is. Profile it on the Linux kernel (torvalds/linux.git, ~93k files / ~5k directories) and identify the hottest section.

Suspect O(N²) loops in street collision detection or building rasterization (layoutV4 is ~920 lines with hierarchical street/stem placement). Don't touch the OUTPUT (positions, dimensions) — keep the algorithm's results bit-identical against the existing snapshot tests in app/tests/scene/layoutV4.test.ts and app/tests/scene/layoutV4-trace.test.ts. Only change implementation. The layout cache wrapper in app/scene/layoutClient.ts is fine as-is.

Start by adding a single perf log inside layoutV4.ts that breaks down time per phase (tree walk / street placement / collision check / building dimension assignment / etc.) so we know what's actually slow before changing anything. Then bring me the perf breakdown and a proposed approach before refactoring.
```
