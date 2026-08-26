# Layout tests

Why the numbers in `algorithm.test.ts` are what they are. The tests assert
behaviour; this holds the derivations and the bug history behind them, so the
assertions can stay short.

## Building dimensions

**Height** is sqrt-normalized across the project's line-count range: the
smallest file gets `min_floors`, the largest `max_floors`, and everything
between interpolates on `sqrt(lines)`. With no `lineStats`, the safe default is
`min_floors`.

Worked example, the 100-line file in a repo whose biggest file is 1000 lines
(under 2000, so the repo ceiling is ≈21.5 floors):

```
sMin   = sqrt(10)   =  3.162
sMax   = sqrt(1000) = 31.62
sLines = sqrt(100)  = 10
t      = (10 - 3.162) / (31.62 - 3.162) ≈ 0.240
floors = round(1 + 0.240 × (21.5 - 1)) = round(5.93) = 6
```

**Width** is log-normalized over the project's own byte range, mirroring the
floors-from-lines mapping.

**Media files** (image/video) get an aspect-driven height instead: the
silhouette mirrors the image. Width still comes from bytes; floors snap to
`round(width × aspect / FLOOR_HEIGHT)`. Missing dimensions fall back to square
(aspect = 1). A file with `media_*` fields but no media kind ignores them
outright and goes back through the sqrt path, which is why a 9999:1 aspect does
not produce a 1-floor building.

## File stats

`computeFileStats` reads pre-computed ranges from `manifest.stats` rather than
walking the tree. It falls back to `{min: 1, max: 1}` — safe for division — when
stats are absent or carry the empty sentinel `{min: 0, max: 0}`.

## Side distribution and stem order

A directory full of files must populate **both** sides of its street rather than
stacking onto side 0. The tests read this off building `orient`: a building's
door faces back toward its street, so files on the primary side carry `s`/`e`
and the secondary side `n`/`w`, depending on street orientation.

The occupancy packer enforces a monotonic `priorStemX` across both sides:
alphabetically-earlier children sit at lower along-axis positions than later
ones, whichever side they land on. Under best-fit area balancing a flat run of
equal-size files spreads across both sides while keeping that order, and pairs
symmetrically: the first file on side 0 makes side 1 the smaller-area side, so
the next equal-size file lands on side 1 at the same stem-x.

## Mirror orient

Nested directories flip coordinates as they recurse. The deep-nesting test
builds a tree where a grandchild file passes through **two** levels of
mirroring:

```
root
  aaaa/    (ci=0 → primary side of root: negateY)
    inner/ (ci=0 → primary side of aaaa: negateX)
      f1.ts f2.ts
  bbbb/    (ci=1 → secondary side of root: no mirror)
    f3.ts
```

Every building's `orient` must still point at its own street after all the
flips.

## Root street length

Two guards, both about a big subtree pushing its parent's road around.

**The alongLow clamp.** A big subtree under root has `alongLow ≪ 0`. Without the
clamp at root, `big` sits at a low stem-x and its content extends back into the
gem-area open space instead of pushing the street forward to host its bbox
reach. The contract: no overlap, alphabetical stems, and a root street much
shorter than the worst case of stacking every bbox sequentially.

Under `max(W,H)` side selection, `big`'s stem lands around 56% of root's road
(≈61 units on a ~108-unit road). Not "near the start" in the v2 sense, but well
within the road and well below the open far end, so root never has to extend
past it.

**The depth-0 two-pass guard.** The original concern — a re-compute lengthening
root — is now mostly absorbed by the packer's `max(W,H)` side selection, since
pre-compute and re-compute usually pick the same `chosenStemX`. The guard stays
as defense in depth for shapes where the two passes still diverge.

Thresholds move when `STREET_TIERS` moves. Root length for that shape measured
~115.4 under the old defaults; after widening the tiers (0→32, 4→48, 8→80,
16→96) the natural length is ~264, so the assertion sits at ~300 — about 36
units of headroom, still tight enough to catch a 2× regression.

## The quickjs case

Reproduces a failure visible in screenshots: `node_modules` had a `quickjs`
child whose own `src/` subdir picked the side facing `node_modules`, forcing the
quickjs road to extend back on itself. Under the packer, `src/` should mirror or
pick the other side and keep that road short.

```
root/
  a-other-pkg/    (medium, alphabetically first)
    file1.ts … file10.ts
  node_modules/   (big, alphabetically next)
    big1.ts … big8.ts
    quickjs/
      qf1.ts qf2.ts qf3.ts
      src/
        sf1.ts sf2.ts
```

Three levels deep on purpose: paths re-prefix all the way down and
`descendants_count` accumulates, which the shared `mkDir` helper (one level
only) does not exercise.

For three files of ~8–16 units each plus end pads, a healthy quickjs road is
~156 units. The bug produced 2–3× that, so the assertion sits at 210 — well
above the legitimate floor, well below the bug regime.

## Phantom sizing

`estimateDirReaches` is a bottom-up pre-pass that sizes the phantom seeded into
each child recursion. It must approximate or upper-bound the actual placement's
along/perp extents: undersizing it reintroduces the grandchild-overlaps-ancestor
bug.

The stress test mirrors the firecrawl / Linux-scale shape — a long-road ancestor
(`apps`) whose alphabetically-first child (`api`) has a deep subtree running
along that road. Before the `estimateDirAlongReach` fix, the phantom was sized
`parentMaxBoundary × 2 + 1000` at recursion start, when `parentMaxBoundary` was
still tiny because `api` was the first child; deep grandchildren placed past the
phantom could land on top of `apps`' trunk. The sanity assertion checks `apps`'
trunk extends well past that old ≈1000 reach, so a too-short phantom would
surface.
