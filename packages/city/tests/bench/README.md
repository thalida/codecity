# Benches

Timing harnesses, run with `npm run bench` (or `vitest run --project=bench`).
Excluded from `npm test`: they are slow by design, and none of them assert a
timing, so they cannot fail a build. They exist to pick the fix order for a
performance problem, not to guard against one.

Correctness guards live with the unit tests, even when they are slow. A guard
parked here would run in neither CI nor the pre-push gate, which is the whole
point of having it.

## largeRepoProfile

Per-phase profiler for the manifest → city apply pipeline at scale (issue #75:
a Linux-scale repo, ~80k files and 100k+ commits, hangs on render, while an
image-heavy repo lags on load). Both workloads stress different phases, so each
phase is timed for both.

Phases, in the real apply order (`city/state` + the components):

| #   | Phase                  | What it costs                                             |
| --- | ---------------------- | --------------------------------------------------------- |
| 1   | `layoutCity`           | the worker's compute (sync here; jsdom has no Worker)     |
| 2   | `structuredClone`      | the worker postMessage payload, full vs slim              |
| 3   | bbox                   | the `state/index.ts` computed: street rects + footprints  |
| 4   | `buildCellsFromLayout` | buildings assembly: spatial grid + per-cell InstancedMesh |
| 5   | ad-panel registration  | media billboards, synchronous CPU per media building      |
| 6   | street labels          | one canvas + measureText + CanvasTexture per street       |
| 7   | picker raycast         | one pointer-move pick against every building instance     |

**Which numbers to trust.** Phases 1–5 and 7 are pure JS and three.js math, so
they translate to the browser directly. Phase 6 does not: jsdom's canvas backend
(node-canvas/Cairo, CPU) rasterizes text roughly 100x slower than a browser's
GPU canvas, so its milliseconds are inflated. The machine-independent part of
the label phase, geometry and mesh allocation, is small (~17ms for 24k planes,
measured separately). The real browser cost there is the texture COUNT — no
cache, no LOD — not the per-canvas time this bench reports.

Not covered here: the decoration pass has its own bench
(`treeDecorationProfile`), and async image decode plus GPU texture upload need a
real browser, so they were reasoned about in the issue instead.

Two details worth knowing when reading the file: the bbox phase re-implements
the `state/index.ts` computed rather than constructing a whole CityState, and
the buildings phase clones the buildings with media stripped so it measures cell
assembly without firing the async fetch/decode path (which phase 5 then times on
its own).
