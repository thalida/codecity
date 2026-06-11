// city/applyManifest.ts — the manifest build/rebuild pipeline extracted from
// world.ts into a factory. createApplyManifest(deps) returns the API
// ({ applyManifest, resetCaches, invalidateLayoutCache }) world (and, later,
// the composer) installs on its public surface.
//
// State split:
//   - The SIX cross-boundary fields (manifest/layout/bbox/latestWorldBounds +
//     the rootStreet/gemWorldPos computeds) live in the `cityState` SIGNALS
//     object (city/state/cityState.ts). world.ts holds the same instance and points
//     every accessor at cityState.X.value. applyManifest sets the four source
//     signals' .value; the two computeds derive off layout automatically.
//   - The eleven manifest-bound mirrors/caches that NO accessor reads (street
//     mesh arrays, cell mirrors, layout/atlas/scenic caches, generation
//     counter) are private to this factory's closure (the `internal` object).
//     resetCaches()/invalidateLayoutCache() (returned below) clear the cache
//     subset for world's resetCache/invalidateLayoutCache.

import * as THREE from 'three';
import { batch } from '@preact/signals';

import { buildIconAtlas } from './components/buildings/atlas';
import { labelFromManifest } from '@/utils/sources';
import type { CellTile } from './components/buildings/cellTile';
import { BuildingIndex } from './components/buildings/buildingIndex';
import type { Buildings } from './components/buildings';
import { createLayoutClient } from './layout/runner';
import type { LayoutComputeOpts } from './layout/runner';
import type { Gem } from './components/gem';
import type { Sky } from './components/sky';
import type { Streets } from './components/streets';
import type { RepoLabel } from './components/repoLabel';
import type { TreesComponent } from './components/trees';
import type { FirefliesComponent } from './components/fireflies';
import type { PathLine } from './components/pathLine';
import type { TreePlacementClient } from './components/trees/treePlacementClient';
import type { Island } from './components/island';
import { getWorldBounds } from './utils/floorBounds';
import type { Footprint } from './components/footprint';
import { computeCityDiff, type PrevState } from './utils/cityDiff';
import type { CityState } from './state/cityState';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { TREES } from '@/state/stores/settings/trees';
import { SCENE } from '@/state/stores/settings/scene';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import type { CityBbox, CityLayout, DateRanges, Manifest, WorldDiff } from '@/types';

// The flat ground meshes (sidewalks, paths, asphalt) all use a single
// MeshBasicMaterial. Matches world.ts's FlatMesh alias.
type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

// Factory-private manifest-bound state that NO world accessor reads. Lives in a
// plain object inside createApplyManifest's closure (not on the cross-boundary
// signals object) — reassigned across applyManifest calls; the cache subset is
// also nulled by the returned resetCaches()/invalidateLayoutCache().
interface InternalCityState {
  // Reassigned from the streets component on rebuild. Read by the PrevState
  // capture + the city diff street branch (both vestigial — no consumer reads
  // the resulting street diff — but kept byte-identical).
  streetPickables: FlatMesh[];
  streetLabels: THREE.Group[];
  asphaltMeshes: FlatMesh[];

  // Cell-rendering state mirrors. The buildings component OWNS the cell scene
  // + lookups; these are reassigned mirrors (set from the component after each
  // rebuild) feeding the PrevState snapshot + city diff building branch.
  cells: Map<number, CellTile>;
  buildingIndex: BuildingIndex | null;

  // Layout cache (keyed by manifest.tree_signature).
  cachedLayoutTreeSig: string | null;
  cachedLayout: CityLayout | null;

  // tree_signature of the manifest the building-roof icon atlas was last built for.
  lastAtlasTreeSig: string | null;

  // Generation counter: each applyManifest invocation increments this and
  // captures its own value. A superseded call bails when generation has
  // advanced past its captured value.
  generation: number;
}

export interface ApplyManifestDeps {
  components: {
    gem: Gem;
    sky: Sky;
    island: Island;
    repoLabel: RepoLabel;
    footprint: Footprint;
    streets: Streets;
    buildings: Buildings;
    trees: TreesComponent;
    fireflies: FirefliesComponent;
    pathLine: PathLine;
  };
  scene: THREE.Scene;
  layoutClient: ReturnType<typeof createLayoutClient>;
  treePlacementClient: TreePlacementClient;
  // The cross-boundary state — a per-city signals object. world.ts holds the
  // same instance; applyManifest sets the four source signals' .value.
  cityState: CityState;
  // Fires the before-change listeners with the prev snapshot.
  emitBeforeChange: (prev: PrevState) => void;
  // Fires the change listeners with a diff.
  emitChange: (diff: WorldDiff) => void;
}

// The API createApplyManifest returns: the apply function plus the two cache
// clearers world delegates resetCache/invalidateLayoutCache to (the cache
// fields now live in this factory's private `internal` object).
export interface ApplyManifestApi {
  applyManifest: (newManifest: Manifest | { tree: unknown; [k: string]: unknown }) => Promise<void>;
  // Clears the full internal cache set (layout + scenic). world.resetCache also
  // disposes the buildings component's ad panels.
  resetCaches: () => void;
  // Clears only the layout cache (cachedLayout + its tree_signature key).
  invalidateLayoutCache: () => void;
}

export function createApplyManifest(deps: ApplyManifestDeps): ApplyManifestApi {
  const {
    components,
    scene,
    layoutClient,
    treePlacementClient,
    cityState,
    emitBeforeChange,
    emitChange,
  } = deps;
  // The gem / island / repoLabel components are received in `components` (world
  // constructs + wires them) but applyManifest no longer touches them — they
  // rebuild themselves reactively off the cityState signals applyManifest sets
  // (gem off rootStreet, island off latestWorldBounds, repoLabel off manifest +
  // gemWorldPos). Only footprint/streets/buildings/trees/fireflies are still
  // driven imperatively here, so only those are destructured.
  const {
    footprint: _footprint,
    streets: _streets,
    buildings: _buildings,
    trees: _trees,
    fireflies: _fireflies,
  } = components;

  // Factory-private manifest-bound state no accessor reads (see
  // InternalCityState). Reassigned across applyManifest calls; the cache subset
  // is nulled by resetCaches()/invalidateLayoutCache() below.
  const internal: InternalCityState = {
    streetPickables: [],
    streetLabels: [],
    asphaltMeshes: [],
    cells: new Map(),
    buildingIndex: null,
    cachedLayoutTreeSig: null,
    cachedLayout: null,
    lastAtlasTreeSig: null,
    generation: 0,
  };

  // Thin wrapper over the pure computeCityDiff, threading the internal live
  // mirrors (cells/buildingIndex/streetPickables) into the `next` snapshot.
  function _computeDiff(prev: PrevState): WorldDiff {
    return computeCityDiff(prev, {
      cells: internal.cells,
      buildingIndex: internal.buildingIndex,
      streetPickables: internal.streetPickables,
    });
  }

  // Manifest is typed loosely because world.test.ts builds mock manifests with
  // string `type` fields rather than the literal 'directory'/'file'. Real
  // callers (the scanner/IPC path) hand us proper Manifest objects.
  async function applyManifest(
    newManifest: Manifest | { tree: unknown; [k: string]: unknown }
  ): Promise<void> {
    const myGeneration = ++internal.generation;
    const newManifestTyped = newManifest as Manifest;

    // Friendly display name: rewrite tree.name to the human label derived from
    // display_root/remote_url BEFORE building, so every downstream consumer
    // (root street label, tree root row, footer, document.title) shows it
    // instead of the cache-dir hash. Cheap + idempotent.
    const _friendlyName = labelFromManifest(newManifestTyped);
    if (newManifestTyped.tree && _friendlyName) {
      newManifestTyped.tree.name = _friendlyName;
    }

    const prev: PrevState = {
      streetPickables: internal.streetPickables,
      streetLabels: internal.streetLabels,
      asphaltMeshes: internal.asphaltMeshes,
      manifest: cityState.manifest.value,
      layout: cityState.layout.value,
      cells: internal.cells,
      buildingIndex: internal.buildingIndex,
    };

    emitBeforeChange(prev);

    // Refresh the building-roof icon atlas when the file structure changed.
    // Building it is expensive (one fetch+draw per unique icon), so gate on the
    // structure-only tree_signature: settings-driven rebuilds re-apply the same
    // manifest (skip), while initial load / a new source / a live-update poll
    // with new or renamed files rebuild it. Done before the cell pass below so
    // the buildings sample the right glyphs.
    const _atlasTreeSig = newManifestTyped.tree_signature ?? '';
    if (_atlasTreeSig !== internal.lastAtlasTreeSig) {
      try {
        const atlas = await buildIconAtlas(newManifestTyped);
        if (myGeneration !== internal.generation) return; // superseded mid-build
        internal.lastAtlasTreeSig = _atlasTreeSig;
        // Push the atlas into the buildings component's shared material + cell
        // factory BEFORE the cell pass below (rebuild reads it while assembling
        // the cells). The atlas ensure stays here (Option B): the
        // tree_signature gate + the myGeneration supersede check above are
        // world-owned.
        _buildings.setAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    // ---- Phase 1: compute the new layout off-thread via layoutClient.
    // A later applyManifest can preempt us by bumping the generation;
    // layoutClient signals that via a 'superseded' rejection.
    // Use the server-computed tree_signature as the layout-cache key.
    // It is structure-only (paths + nesting, NO mtime/size), so it is
    // stable across skeleton/final events for the same scan.
    const _treeSig = newManifestTyped.tree_signature ?? '';
    const _reuseFrom =
      _treeSig && internal.cachedLayoutTreeSig === _treeSig ? internal.cachedLayout : null;
    const _layoutComputeOpts: LayoutComputeOpts = _reuseFrom ? { reuseLayoutFrom: _reuseFrom } : {};
    let newLayout: CityLayout;
    // Pass the full manifest envelope (not `manifest.tree`) — the worker
    // forwards it to layoutCityV4, which internally unwraps `.tree` via
    // `(manifest as { tree?: DirLike }).tree ?? manifest`. Both shapes
    // produce the same layout, but routing through the envelope keeps
    // the worker message contract typed against `Manifest` rather than
    // a structural `DirLike`. A reject with `Error('superseded')` is
    // expected when a newer applyManifest preempts us — return silently
    // so the newer run owns the swap.
    try {
      newLayout = await layoutClient.compute(newManifestTyped, _layoutComputeOpts);
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    // Scenic-reuse flag: a layout-cache hit means the worker reused the prior
    // layout (same positions), so we keep the existing layout/bbox/bounds
    // signal references stable below — the scenic effects then skip natively.
    const reused = _reuseFrom !== null;
    // Cache the layout for the next call (keyed by tree_signature).
    if (_treeSig) {
      internal.cachedLayoutTreeSig = _treeSig;
      internal.cachedLayout = newLayout;
    }
    if (myGeneration !== internal.generation) return;

    // ---- Phase 2: date ranges for the NEW layout come straight off the
    // manifest (computed on the backend during the scan, like busyness).
    // The per-building color/age writes happen inside _buildings.rebuild
    // (which receives these date ranges). Nothing here touches the scene
    // yet.
    const newDateRanges: DateRanges = newManifestTyped.dateRanges;
    // Per-building color/age writes + the cell assembly moved into
    // _buildings.rebuild(newLayout, newDateRanges) below.
    if (myGeneration !== internal.generation) return;

    // ---- Cell rendering path ---------------------------------------------
    // The buildings component owns the SpatialGrid + CellTile scene. It colors
    // the buildings, assembles the cells, swaps them into its persistent group
    // (disposing the prior cell root WITHOUT freeing the shared material), and
    // rebuilds the building-by-path lookup. Always rebuilt (the cell root is
    // the one thing always rebuilt — NOT scenic-gated) to reflect updated
    // per-file metadata (colors, heights). rebuild has no internal await, so
    // it cannot be superseded mid-build; world mirrors cells/buildingIndex
    // from it AFTER (and before _computeDiff) for the Option B diff.

    // ---- Reactive scenic swap ----
    //
    // The sync scenic components (streets, gem, footprint, island, repoLabel)
    // no longer get called in order here. Each one runs its own effect reading
    // the cityState signal it depends on (layout / rootStreet / latestWorldBounds
    // / manifest+gemWorldPos) and rebuilds when that signal's value CHANGES.
    //
    // The whole scenic-config-hash gate is gone. Reuse is detected natively by
    // REFERENCE STABILITY: on a scenic-reuse apply we do NOT reassign
    // layout.value / bbox.value / latestWorldBounds.value, so the dependent
    // effects don't re-fire and the existing meshes/bbox/bounds (identical by
    // the layout-cache contract — same positions) stay correct. On a non-reuse
    // apply we reassign layout.value (new object) and the effects rebuild.

    // Buildings rebuild on BOTH branches (always) — never gated by reuse.
    // setAtlas already ran above (before this) so the atlas is in the material
    // before the cells read it. Buildings are NOT reactive (they need the
    // awaited rebuild + the date ranges), so they stay an explicit call.
    await _buildings.rebuild(newLayout, newDateRanges);

    // manifest changes on EVERY apply (name/metadata), so it's always
    // reassigned. layout is reassigned ONLY on a non-reuse apply — keeping the
    // reference stable on reuse is what makes the scenic effects skip. Both
    // writes go in one batch() so the synchronous scenic effects (streets/gem/
    // footprint/repoLabel) all settle at batch-close BEFORE we read
    // _streets.group for the bbox below.
    batch(() => {
      cityState.manifest.value = newManifestTyped;
      if (!reused) cityState.layout.value = newLayout;
    });

    if (!reused) {
      // Non-reuse: the streets effect just rebuilt the meshes synchronously at
      // batch-close, so _streets.group is populated here. Reassign the internal
      // street-array mirrors from the component so PrevState/_computeDiff still
      // read populated arrays (the street diff is vestigial — see comment at
      // the _streets construction site).
      internal.streetPickables = _streets.pickables();
      internal.streetLabels = _streets.labels();
      internal.asphaltMeshes = _streets.asphalt();

      // bbox over the street meshes only (same geometry set the old
      // _buildWorld local-scene bbox covered) — NOT setFromObject(scene),
      // since the world scene now also holds sky/island/gem/footprint, which
      // would yield the wrong bbox. Empty fallback prevents NaN at boot when
      // the layout has zero meshes (matches the old _buildWorld fallback).
      const bbox = new THREE.Box3().setFromObject(_streets.group);
      if (bbox.isEmpty()) {
        bbox.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
      }
      // The street bbox covers streets only — NOT buildings (rendered
      // separately via the cell-based instanced renderer). Expand the bbox to
      // include each building's XZ footprint + Y height so downstream
      // consumers (sceneBbox sizing, camera framing in cameraRig) get the
      // FULL visible city.
      for (const b of newLayout.buildings) {
        bbox.expandByPoint(new THREE.Vector3(b.x - b.w / 2, 0, b.y - b.d / 2));
        bbox.expandByPoint(new THREE.Vector3(b.x + b.w / 2, b.h, b.y + b.d / 2));
      }
      // Expand by the city-footprint halo width so the bbox includes the
      // asphalt slab that wraps around the city silhouette (every layout
      // rect is inflated by HALO_WIDTH for the footprint pass). Only
      // expand XZ — Y stays bounded by the actual building heights so
      // cityHeight calc isn't inflated.
      const footprintCfg = FOOTPRINT.value;
      if (footprintCfg.ENABLED && footprintCfg.HALO_WIDTH > 0) {
        const halo = footprintCfg.HALO_WIDTH;
        bbox.min.x -= halo;
        bbox.min.z -= halo;
        bbox.max.x += halo;
        bbox.max.z += halo;
      }
      cityState.bbox.value = bbox;

      scene.background = new THREE.Color(SCENE.value.SKY_COLOR);
    }
    // On reuse: bbox stays from the previous non-reuse apply (layout unchanged
    // → same positions → same bbox). latestWorldBounds (set below, also reuse-
    // gated) likewise stays, so the island effect doesn't re-fire either.

    // Mirror the buildings component's cells + index into the internal state
    // for the Option B diff. _buildings is the source of truth; we read these
    // mirrors in PrevState.cells (next applyManifest) + _computeDiff (below).
    // MUST run AFTER rebuild and BEFORE _computeDiff(prev). The `prev` snapshot
    // captured the OLD cells at the top of applyManifest — never reassign
    // internal.cells before that capture.
    internal.cells = _buildings.getCells();
    internal.buildingIndex = _buildings.getBuildingIndex();

    // The gem is no longer rebuilt imperatively: its effect reads
    // cityState.rootStreet (computed off layout), which is reference-stable on
    // reuse → the gem rebuilds EXACTLY on non-reuse, matching when buildWorld
    // used to build it (reuse leaves the existing gem untouched, avoiding a
    // flash + GPU realloc).

    // City is now in the scene. Decoration pass (trees, future mesa
    // bounds, etc.) is deferred to the next animation frame so the
    // city paints + becomes interactive BEFORE the placement scan +
    // GPU upload blocks the main thread. For large repos this gap is
    // the difference between a snappy rebuild and a multi-hundred-ms
    // freeze.
    const treesEnabled = TREES.value.ENABLED;
    // Trees + fireflies are rebuilt every applyManifest (never scenic-gated).
    // clear() the inner meshes BEFORE the first onChange emit below so the
    // picker's pickables refresh sees no tree meshes on that emit —
    // identical to the old dispose-then-emit ordering. clear() is idempotent.
    _trees.clear();
    _fireflies.clear();
    emitChange(_computeDiff(prev));

    // Convert the THREE.Box3 (now includes building footprints — expanded
    // above right after the _streets.group bbox assignment) to a placement-style
    // CityBbox.
    const bbox = cityState.bbox.value;
    const sceneBbox: CityBbox | null = bbox
      ? {
          minX: bbox.min.x,
          maxX: bbox.max.x,
          minY: bbox.min.z, // three.js Z is the second world axis
          maxY: bbox.max.z,
          cx: (bbox.min.x + bbox.max.x) / 2,
          cy: (bbox.min.z + bbox.max.z) / 2,
          width: bbox.max.x - bbox.min.x,
          depth: bbox.max.z - bbox.min.z,
        }
      : null;
    // City's vertical extent — feeds into worldBounds so small-but-tall
    // repos still get an airy floor buffer relative to building height.
    const cityHeight = bbox ? bbox.max.y - bbox.min.y : 0;

    // The repo-name label repositions itself reactively: its manifest/anchor
    // effect reads cityState.manifest + cityState.gemWorldPos (both settled in
    // the batch above) and re-points name/anchor/gem. Not called here anymore.

    // Floor bounds drive the island. On a non-reuse apply the bbox changed, so
    // recompute + reassign latestWorldBounds (the island effect re-fires). On
    // reuse the bbox is unchanged, so keep the existing latestWorldBounds
    // reference — the island effect doesn't re-fire (no resize flash), matching
    // the old gate where the floor was only re-sized on a full rebuild path.
    if (!reused) {
      // Floor is sized from the scene's bbox + buffer. Falls back to a
      // small default at the origin when there's no city (empty manifest).
      cityState.latestWorldBounds.value = getWorldBounds(sceneBbox, cityHeight);
    }

    if (bbox) {
      // Footprint rebuilds on EVERY apply (NOT reactive off cityState.layout):
      // the slabs wrap each building's rect, and building w/d/h are recomputed
      // from fresh per-file metadata on a layout-reuse apply (skeleton→final /
      // live update), so the footprint must rebuild to stay matched to the
      // buildings — same as the buildings cell root above. Cheap (one
      // InstancedMesh, no rejection sampling), so no rAF+setTimeout defer.
      // rebuild() disposes the prior inner mesh and builds a new one into the
      // persistent _footprint.group (already in the scene).
      _footprint.rebuild(newLayout);
    }

    if (treesEnabled && bbox && sceneBbox) {
      // Snapshot what the deferred pass needs so a later applyManifest
      // bumping the generation doesn't race with this build.
      const generationAtDefer = myGeneration;
      const layoutAtDefer = newLayout;
      const commitCountAtDefer = cityState.manifest.value!.commits?.length ?? 0;
      const cityHeightAtDefer = cityHeight;
      const foliageBbox: CityBbox = sceneBbox;

      REBUILD_STATUS.value = RebuildStatus.Decorating;
      // rAF lets the browser START the next frame; setTimeout(0)
      // then yields the task so the browser can COMPLETE the paint
      // before foliage work begins.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
      if (generationAtDefer !== internal.generation) return;

      // Off-thread tree placement via the worker. The supersede protocol
      // rejects this promise with "superseded" if another applyManifest
      // fires while placement is in-flight.
      let treePlacements: import('./components/trees/treePlacement.js').TreePlacement[];
      try {
        treePlacements = await treePlacementClient.compute(
          layoutAtDefer,
          foliageBbox,
          commitCountAtDefer,
          cityHeightAtDefer
        );
      } catch (err) {
        if (err instanceof Error && err.message === 'superseded') return;
        throw err;
      }
      if (generationAtDefer !== internal.generation) return;

      _trees.rebuild(
        treePlacements,
        cityState.manifest.value!.commits ?? null,
        cityState.manifest.value!.busyness ?? { avg: 1, busy: 1 }
      );
      _fireflies.rebuild(treePlacements, cityState.manifest.value!.commits ?? null);

      // Re-notify listeners now that async decoration (trees) is
      // fully attached to the scene. The first onChange fired before this
      // deferred block ran, so world.getTrees() returned null at that
      // point — the picker's _refreshPickables() therefore had no tree
      // meshes to include. This second emit gives the picker (and any
      // other subscriber) a chance to re-refresh with the live tree group.
      // We pass an empty diff because only foliage changed; no building or
      // street geometry was added since the first emit.
      // Defensive guard — always true today: rebuild() above always sets
      // the handle, and the disabled/empty cases bail at the deferred-block
      // gate (treesEnabled && bbox && sceneBbox) before reaching here.
      if (_trees.handle() !== null) {
        emitChange({
          entering: { buildings: [], streets: [] },
          exiting: { buildings: [], streets: [] },
          staying: { buildings: [], streets: [] },
        });
      }

      REBUILD_STATUS.value = RebuildStatus.Idle;
    } else {
      // No deferred decoration pass (trees disabled, or an empty/degenerate
      // bbox), so there's no async foliage work to await — drop straight back
      // to Idle. Without this, a caller that flipped REBUILD_STATUS to
      // Rebuilding (the live-update render effect in useCityScene, or a
      // settings rebuild) would never be cleared and the footer dot would
      // stick yellow. Superseded applies bail via the early returns inside the
      // if-branch above and never reach here, so they can't clobber the status
      // of a newer apply that has already taken over.
      REBUILD_STATUS.value = RebuildStatus.Idle;
    }
  }

  // Clear the internal layout cache. world.resetCache wraps this (and
  // additionally disposes the buildings component's ad panels). With the
  // scenic-config-hash gate gone, the only internal cache is the layout cache,
  // so this is now equivalent to invalidateLayoutCache(); both are kept because
  // world delegates resetCache + invalidateLayoutCache to distinct entry points
  // (and resetCache layers the ad-panel disposal on top). Does NOT touch the
  // cross-boundary signals: layout stays, so rootStreet/gemWorldPos (computed
  // off it) stay valid — matching the old resetCache, which never touched them.
  function resetCaches(): void {
    internal.cachedLayoutTreeSig = null;
    internal.cachedLayout = null;
  }

  // Clear only the layout cache (cachedLayout + its tree_signature key).
  // world.invalidateLayoutCache delegates straight here. A config-only Save
  // calls this before re-applying the same manifest, forcing the next apply
  // onto the non-reuse path (new layout reference → scenic effects rebuild).
  function invalidateLayoutCache(): void {
    internal.cachedLayoutTreeSig = null;
    internal.cachedLayout = null;
  }

  return { applyManifest, resetCaches, invalidateLayoutCache };
}
