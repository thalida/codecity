// city/applyManifest.ts — the manifest build/rebuild pipeline extracted from
// world.ts into a factory. createApplyManifest(deps) returns the
// applyManifest(manifest) function world (and, later, the composer) installs
// on its public surface.
//
// CRITICAL correctness contract: the factory mutates a SHARED `cityState` bag
// passed in by reference. world.ts holds the same object and points every
// accessor getter (getManifest/getLayout/getBbox/getRootStreet/…) plus
// resetCache/invalidateLayoutCache + the pathLine gemWorldPos closure at
// cityState.X. The factory must NEVER destructure-copy a field out of
// cityState and write the copy — that would typecheck but leave the accessors
// reading stale state (null sidebar / camera). Every read + write goes through
// `cityState.X` so the single object reference stays the source of truth.

import * as THREE from 'three';

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
import { getWorldBounds, type WorldBounds } from './utils/floorBounds';
import type { Footprint } from './components/footprint';
import { computeCityDiff, type PrevState } from './utils/cityDiff';
import { computeScenicConfigHash } from './utils/scenicHash';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { TREES } from '@/state/stores/settings/trees';
import { SCENE } from '@/state/stores/settings/scene';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import type { CityBbox, CityLayout, DateRanges, Manifest, Street, WorldDiff } from '@/types';

// The flat ground meshes (sidewalks, paths, asphalt) all use a single
// MeshBasicMaterial. Matches world.ts's FlatMesh alias.
type FlatMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

// The mutable manifest-bound state. Held by world.ts as a single object and
// passed into the factory BY REFERENCE. Both sides read + write through the
// same reference; every field below is reassigned across applyManifest calls
// (or by world's resetCache / invalidateLayoutCache).
export interface CityState {
  manifest: Manifest | null;
  layout: CityLayout | null;
  bbox: THREE.Box3 | null;
  rootStreet: Street | null;
  gemWorldPos: THREE.Vector3 | null;
  latestWorldBounds: WorldBounds | null;

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

  // Scenic state cache: tree_signature buildWorld last ran for, plus the config
  // hash of the stores baked into scenic output at that time.
  lastBuildWorldTreeSig: string | null;
  lastScenicConfigHash: string | null;

  // Generation counter: each applyManifest invocation increments this and
  // captures its own value. A superseded call bails when generation has
  // advanced past its captured value.
  generation: number;
}

// Construct a fresh, empty CityState. world.ts calls this once and keeps the
// returned reference for the lifetime of the world.
export function createCityState(): CityState {
  return {
    manifest: null,
    layout: null,
    bbox: null,
    rootStreet: null,
    gemWorldPos: null,
    latestWorldBounds: null,
    streetPickables: [],
    streetLabels: [],
    asphaltMeshes: [],
    cells: new Map(),
    buildingIndex: null,
    cachedLayoutTreeSig: null,
    cachedLayout: null,
    lastAtlasTreeSig: null,
    lastBuildWorldTreeSig: null,
    lastScenicConfigHash: null,
    generation: 0,
  };
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
  // The mutable bag — passed BY REFERENCE; never destructure-copied.
  cityState: CityState;
  // Fires the before-change listeners with the prev snapshot.
  emitBeforeChange: (prev: PrevState) => void;
  // Fires the change listeners with a diff.
  emitChange: (diff: WorldDiff) => void;
  // The no-op manifest-state disposer kept on world's surface (also called by
  // world.dispose). Threaded in so the full-rebuild branch calls it at the
  // exact same point as before.
  disposeAllManifestState: () => void;
}

export function createApplyManifest(
  deps: ApplyManifestDeps
): (newManifest: Manifest | { tree: unknown; [k: string]: unknown }) => Promise<void> {
  const {
    components,
    scene,
    layoutClient,
    treePlacementClient,
    cityState,
    emitBeforeChange,
    emitChange,
    disposeAllManifestState,
  } = deps;
  const {
    gem: _gem,
    island: _island,
    repoLabel: _repoLabel,
    footprint: _footprint,
    streets: _streets,
    buildings: _buildings,
    trees: _trees,
    fireflies: _fireflies,
  } = components;

  // Compute the root street + gem world position from the current layout,
  // writing both into the shared cityState bag.
  function _computeRootStreetAndGem(): void {
    cityState.rootStreet = (cityState.layout?.streets ?? []).filter((s) => s.isRoot)[0] || null;
    const rootStreet = cityState.rootStreet;
    if (!rootStreet) {
      cityState.gemWorldPos = null;
      return;
    }
    const gemWorldPos = new THREE.Vector3();
    // StreetAxis import is not needed here — use orientation string directly.
    if (rootStreet.orientation === 'x') {
      gemWorldPos.set(rootStreet.x - rootStreet.length / 2 + rootStreet.width / 2, 0, rootStreet.y);
    } else {
      gemWorldPos.set(rootStreet.x, 0, rootStreet.y - rootStreet.length / 2 + rootStreet.width / 2);
    }
    cityState.gemWorldPos = gemWorldPos;
  }

  // Thin wrapper over the pure computeCityDiff, threading the bag's live
  // mirrors (cells/buildingIndex/streetPickables) into the `next` snapshot.
  function _computeDiff(prev: PrevState): WorldDiff {
    return computeCityDiff(prev, {
      cells: cityState.cells,
      buildingIndex: cityState.buildingIndex,
      streetPickables: cityState.streetPickables,
    });
  }

  // Manifest is typed loosely because world.test.ts builds mock manifests with
  // string `type` fields rather than the literal 'directory'/'file'. Real
  // callers (the scanner/IPC path) hand us proper Manifest objects.
  return async function applyManifest(
    newManifest: Manifest | { tree: unknown; [k: string]: unknown }
  ): Promise<void> {
    const myGeneration = ++cityState.generation;
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
      streetPickables: cityState.streetPickables,
      streetLabels: cityState.streetLabels,
      asphaltMeshes: cityState.asphaltMeshes,
      manifest: cityState.manifest,
      layout: cityState.layout,
      cells: cityState.cells,
      buildingIndex: cityState.buildingIndex,
    };

    emitBeforeChange(prev);

    // Refresh the building-roof icon atlas when the file structure changed.
    // Building it is expensive (one fetch+draw per unique icon), so gate on the
    // structure-only tree_signature: settings-driven rebuilds re-apply the same
    // manifest (skip), while initial load / a new source / a live-update poll
    // with new or renamed files rebuild it. Done before the cell pass below so
    // the buildings sample the right glyphs.
    const _atlasTreeSig = newManifestTyped.tree_signature ?? '';
    if (_atlasTreeSig !== cityState.lastAtlasTreeSig) {
      try {
        const atlas = await buildIconAtlas(newManifestTyped);
        if (myGeneration !== cityState.generation) return; // superseded mid-build
        cityState.lastAtlasTreeSig = _atlasTreeSig;
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
      _treeSig && cityState.cachedLayoutTreeSig === _treeSig ? cityState.cachedLayout : null;
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
    const _layoutReused = _reuseFrom !== null;
    // Cache the layout for the next call (keyed by tree_signature).
    if (_treeSig) {
      cityState.cachedLayoutTreeSig = _treeSig;
      cityState.cachedLayout = newLayout;
    }
    if (myGeneration !== cityState.generation) return;

    // ---- Phase 2: date ranges for the NEW layout come straight off the
    // manifest (computed on the backend during the scan, like busyness).
    // The per-building color/age writes happen inside _buildings.rebuild
    // (which receives these date ranges). Nothing here touches the scene
    // yet.
    const newDateRanges: DateRanges = newManifestTyped.dateRanges;
    // Per-building color/age writes + the cell assembly moved into
    // _buildings.rebuild(newLayout, newDateRanges) below.
    if (myGeneration !== cityState.generation) return;

    // ---- Cell rendering path ---------------------------------------------
    // The buildings component owns the SpatialGrid + CellTile scene. It colors
    // the buildings, assembles the cells, swaps them into its persistent group
    // (disposing the prior cell root WITHOUT freeing the shared material), and
    // rebuilds the building-by-path lookup. Always rebuilt (the cell root is
    // the one thing always rebuilt — NOT scenic-gated) to reflect updated
    // per-file metadata (colors, heights). rebuild has no internal await, so
    // it cannot be superseded mid-build; world mirrors cells/buildingIndex
    // from it AFTER (and before _computeDiff) for the Option B diff.

    // ---- Atomic swap ----
    //
    // Scenic state reuse: when the layout was reused (same tree_signature,
    // positions/streets/paths unchanged) AND buildWorld was already run
    // for this signature, AND none of the config stores that affect scenic
    // output have changed (same config hash), the streets/labels/paths/gem
    // meshes are already in the scene and would produce identical output —
    // skip the dispose + rebuild. Only the buildings cell root is always
    // rebuilt (fast) to reflect updated per-file metadata (colors, heights).
    const _currentScenicConfigHash = computeScenicConfigHash();
    const _scenicValid =
      _layoutReused &&
      cityState.lastBuildWorldTreeSig !== null &&
      cityState.lastBuildWorldTreeSig === _treeSig &&
      cityState.lastScenicConfigHash === _currentScenicConfigHash &&
      cityState.streetPickables.length > 0; // guard: scenic state actually exists in scene

    // The gem is rebuilt EXACTLY on the full-rebuild path — never on scenic
    // reuse (rebuilding then would flash + realloc GPU = behavior change).
    const _didFullRebuild = !_scenicValid;

    // Buildings rebuild on BOTH branches (always) — never gated by _scenicValid.
    // setAtlas already ran above (before this) so the atlas is in the material
    // before the cells read it.
    await _buildings.rebuild(newLayout, newDateRanges);

    if (_scenicValid) {
      // Do NOT call disposeAllManifestState() — existing streets/labels/
      // paths/gem stay in the scene unmodified. Do NOT call buildWorld.
      cityState.manifest = newManifestTyped;
      cityState.layout = newLayout;
      // bbox stays from the previous buildWorld call (layout unchanged).
    } else {
      // Full rebuild path: dispose existing scenic state, run buildWorld,
      // and add the new meshes to the scene.
      disposeAllManifestState();

      cityState.manifest = newManifestTyped;
      cityState.layout = newLayout;

      // Rebuild the streets component's meshes (sidewalks, asphalt, labels)
      // into its persistent group (already in the scene). The component owns
      // the meshes + the sidewalk/street lookup maps; we reassign the bag's
      // arrays from the component so PrevState/_computeDiff still read
      // populated arrays (the street diff is vestigial — see comment at the
      // _streets construction site).
      _streets.rebuild(newLayout);
      cityState.streetPickables = _streets.pickables();
      cityState.streetLabels = _streets.labels();
      cityState.asphaltMeshes = _streets.asphalt();

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
      cityState.bbox = bbox;

      scene.background = new THREE.Color(SCENE.value.SKY_COLOR);

      // Record that scenic state is now valid for this tree_signature + config.
      cityState.lastBuildWorldTreeSig = _treeSig || null;
      cityState.lastScenicConfigHash = _currentScenicConfigHash;
    }

    // Mirror the buildings component's cells + index into the bag for the
    // Option B diff. _buildings is the source of truth; we read these mirrors
    // in PrevState.cells (next applyManifest) + _computeDiff (below). MUST run
    // AFTER rebuild and BEFORE _computeDiff(prev). The `prev` snapshot captured
    // the OLD cells at the top of applyManifest — never reassign cityState.cells
    // before that capture.
    cityState.cells = _buildings.getCells();
    cityState.buildingIndex = _buildings.getBuildingIndex();

    _computeRootStreetAndGem();
    // Rebuild the gem's inner mesh only on the full-rebuild path, matching
    // exactly when buildWorld used to build it (scenic reuse leaves the
    // existing gem untouched). rootStreet was just set by the call above.
    if (_didFullRebuild && cityState.rootStreet) _gem.rebuild(cityState.rootStreet);

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
    const bbox = cityState.bbox;
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

    // Floating repo-name label — anchored at the gem position (the
    // floor-level root marker). The label's elevation is governed by
    // REPO_LABEL.HEIGHT_PCT, not by city silhouette: 0 → label flush
    // with the floor; larger → label rises with a visible beam.
    _repoLabel.setRepoName(cityState.manifest!.tree.name);
    _repoLabel.setAnchor(cityState.gemWorldPos ?? new THREE.Vector3());
    // Hand the live gem to the label so its beam foot tracks the
    // gem's hover height + bob animation. _gem.gem is the INNER gem
    // group whose .position.y is mutated each frame by the gem's tick().
    // refresh() is no longer called here — the component's own effect
    // owns REPO_LABEL config reactivity and re-runs on REPO_LABEL Save.
    // setAnchor already calls _applyTransform() which positions the group.
    _repoLabel.setGem(_gem.gem);

    // Floor is sized from the scene's bbox + buffer. Falls back to a
    // small default at the origin when there's no city (empty manifest).
    cityState.latestWorldBounds = getWorldBounds(sceneBbox, cityHeight);
    _island.setBounds(cityState.latestWorldBounds);

    if (bbox) {
      // Footprint is cheap (one InstancedMesh, no rejection sampling),
      // so we don't need the rAF+setTimeout defer the tree path uses.
      // rebuild() disposes the prior inner mesh and builds a new one
      // into the persistent _footprint.group (already in the scene).
      _footprint.rebuild(newLayout);
    }

    if (treesEnabled && bbox && sceneBbox) {
      // Snapshot what the deferred pass needs so a later applyManifest
      // bumping the generation doesn't race with this build.
      const generationAtDefer = myGeneration;
      const layoutAtDefer = newLayout;
      const commitCountAtDefer = cityState.manifest!.commits?.length ?? 0;
      const cityHeightAtDefer = cityHeight;
      const foliageBbox: CityBbox = sceneBbox;

      REBUILD_STATUS.value = RebuildStatus.Decorating;
      // rAF lets the browser START the next frame; setTimeout(0)
      // then yields the task so the browser can COMPLETE the paint
      // before foliage work begins.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
      if (generationAtDefer !== cityState.generation) return;

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
      if (generationAtDefer !== cityState.generation) return;

      _trees.rebuild(
        treePlacements,
        cityState.manifest!.commits ?? null,
        cityState.manifest!.busyness ?? { avg: 1, busy: 1 }
      );
      _fireflies.rebuild(treePlacements, cityState.manifest!.commits ?? null);

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
  };
}
