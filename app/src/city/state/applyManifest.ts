// city/state/applyManifest.ts — the manifest build/rebuild pipeline factory.
// createApplyManifest(deps) returns { applyManifest, resetCaches,
// invalidateLayoutCache }.
//
// State split:
//   - The cross-boundary signals (manifest/layout/bbox/latestWorldBounds +
//     rootStreet/gemWorldPos computeds) live in the `cityState` object
//     (./index). applyManifest sets the source signals' .value; the computeds
//     derive off layout automatically.
//   - The manifest-bound caches that NO accessor reads (the layout cache + its
//     tree_signature key, the icon-atlas tree_signature, the generation
//     counter) are private to this factory's closure (the `internal` object).
//     resetCaches()/invalidateLayoutCache() clear the layout cache.

import * as THREE from 'three';
import { batch } from '@preact/signals';

import { buildIconAtlas } from '../components/buildings/atlas';
import { labelFromManifest } from '@/utils/sources';
import type { Buildings } from '../components/buildings';
import { createLayoutClient } from '../layout';
import type { LayoutComputeOpts } from '../layout';
import type { Gem } from '../components/gem';
import type { Sky } from '../components/sky';
import type { Streets } from '../components/streets';
import type { RepoLabel } from '../components/repoLabel';
import type { TreesComponent } from '../components/trees';
import type { FirefliesComponent } from '../components/fireflies';
import type { PathLine } from '../components/pathLine';
import type { TreePlacementClient } from '../components/trees/treePlacementClient';
import type { Island } from '../components/island';
import { getWorldBounds } from '../utils/floorBounds';
import type { Footprint } from '../components/footprint';
import type { CityState } from './index';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { TREES } from '@/state/stores/settings/trees';
import { SCENE } from '@/state/stores/settings/scene';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/manifest';
import type { CityBbox, CityLayout, DateRanges, Manifest } from '@/types';

// Factory-private manifest-bound caches that NO accessor reads — reassigned
// across applyManifest calls; the layout cache is also nulled by the returned
// resetCaches()/invalidateLayoutCache().
interface InternalCityState {
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
  // The cross-boundary signals. applyManifest sets the source signals' .value
  // and bumps cityRevision / decorationRevision so the reactive consumers
  // (picker, cameraRig, pathLine, buildingFader) re-derive.
  cityState: CityState;
}

export interface ApplyManifestApi {
  applyManifest: (newManifest: Manifest | { tree: unknown; [k: string]: unknown }) => Promise<void>;
  // Clears the internal layout cache. The caller (world.resetCache) additionally
  // disposes the buildings component's ad panels.
  resetCaches: () => void;
  // Clears only the layout cache (cachedLayout + its tree_signature key).
  invalidateLayoutCache: () => void;
}

export function createApplyManifest(deps: ApplyManifestDeps): ApplyManifestApi {
  const { components, scene, layoutClient, treePlacementClient, cityState } = deps;
  // gem / island / repoLabel rebuild themselves reactively off the cityState
  // signals (gem off rootStreet, island off latestWorldBounds, repoLabel off
  // manifest + gemWorldPos), so only the imperatively-driven components are
  // destructured here.
  const {
    footprint: _footprint,
    streets: _streets,
    buildings: _buildings,
    trees: _trees,
    fireflies: _fireflies,
  } = components;

  const internal: InternalCityState = {
    cachedLayoutTreeSig: null,
    cachedLayout: null,
    lastAtlasTreeSig: null,
    generation: 0,
  };

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
        // Push the atlas into the buildings component's shared material BEFORE
        // _buildings.rebuild below reads it while assembling the cells.
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
    // Pass the full manifest envelope (not `manifest.tree`): the layout code
    // unwraps `.tree` itself, and routing through the envelope keeps the worker
    // message contract typed against `Manifest`. A reject with
    // `Error('superseded')` is expected when a newer applyManifest preempts us
    // — return silently so the newer run owns the swap.
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

    // Date ranges for the NEW layout come straight off the manifest (computed
    // on the backend during the scan, like busyness); _buildings.rebuild does
    // the per-building color/age writes from them.
    const newDateRanges: DateRanges = newManifestTyped.dateRanges;
    if (myGeneration !== internal.generation) return;

    // Reuse is detected natively by REFERENCE STABILITY: on a scenic-reuse apply
    // we do NOT reassign layout.value / bbox.value / latestWorldBounds.value, so
    // the dependent scenic effects (streets/gem/footprint/island/repoLabel) don't
    // re-fire and the existing meshes (identical positions by the layout-cache
    // contract) stay correct. On a non-reuse apply we reassign layout.value and
    // the effects rebuild.

    // Buildings rebuild on BOTH branches — never gated by reuse, and not
    // reactive (they need the awaited rebuild + the date ranges). setAtlas ran
    // above so the atlas is in the material before the cells read it.
    await _buildings.rebuild(newLayout, newDateRanges);

    // Clear the tree + firefly inner meshes BEFORE bumping cityRevision below so
    // the picker's pickables refresh (driven by that bump) sees NO tree meshes.
    // The deferred decoration pass rebuilds them and bumps decorationRevision so
    // the picker re-refreshes with the live tree group. clear() is idempotent.
    _trees.clear();
    _fireflies.clear();

    // manifest changes on EVERY apply (name/metadata), so it's always
    // reassigned. layout is reassigned ONLY on a non-reuse apply — keeping the
    // reference stable on reuse is what makes the scenic effects skip. Both
    // writes go in one batch() so the synchronous scenic effects (streets/gem/
    // footprint/repoLabel) all settle at batch-close BEFORE we read
    // _streets.group for the bbox below.
    batch(() => {
      cityState.manifest.value = newManifestTyped;
      if (!reused) cityState.layout.value = newLayout;
      // Bump ONCE per apply, inside the same batch as manifest/layout, so the
      // reactive rebuild consumers (picker re-resolve, cameraRig reframe via
      // bbox, pathLine recompute, buildingFader re-sweep) all see a single
      // settled change. By batch-close the synchronous scenic effects
      // (streets/gem/footprint) have rebuilt, so the streets-by-dir map the
      // pathLine reads through this bump is already fresh.
      cityState.cityRevision.value++;
    });

    if (!reused) {
      // The streets effect just rebuilt the meshes synchronously at batch-close,
      // so _streets.group is populated here.
      //
      // bbox over the street meshes only — NOT setFromObject(scene), since the
      // scene also holds sky/island/gem/footprint, which would yield the wrong
      // bbox. Empty fallback prevents NaN at boot when the layout has zero meshes.
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

    // Decoration pass (trees) is deferred to the next animation frame so the
    // city paints + becomes interactive BEFORE the placement scan + GPU upload
    // blocks the main thread. For large repos this gap is the difference
    // between a snappy rebuild and a multi-hundred-ms freeze.
    const treesEnabled = TREES.value.ENABLED;

    // Convert the THREE.Box3 (includes building footprints, expanded above) to a
    // placement-style CityBbox.
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

    // Floor bounds drive the island. On a non-reuse apply the bbox changed, so
    // recompute + reassign latestWorldBounds (the island effect re-fires). On
    // reuse the bbox is unchanged, so keep the existing latestWorldBounds
    // reference — the island effect doesn't re-fire (no resize flash).
    if (!reused) {
      // Floor is sized from the scene's bbox + buffer. Falls back to a
      // small default at the origin when there's no city (empty manifest).
      cityState.latestWorldBounds.value = getWorldBounds(sceneBbox, cityHeight);
    }

    if (bbox) {
      // Footprint rebuilds on EVERY apply (NOT reactive off cityState.layout):
      // building w/d/h are recomputed from fresh per-file metadata even on a
      // layout-reuse apply (skeleton→final / live update), so the slabs must
      // rebuild to stay matched to the buildings. Cheap (one InstancedMesh), so
      // no defer. rebuild() disposes the prior inner mesh into _footprint.group.
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
      let treePlacements: import('../components/trees/treePlacement.js').TreePlacement[];
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

      // Re-notify the reactive consumers now that async decoration (trees) is
      // fully attached to the scene. The cityRevision bump fired before this
      // deferred block ran, when no tree meshes existed yet, so the picker
      // couldn't re-resolve a Commit selection or include trees in its
      // pickables. This decorationRevision bump gives it that second chance.
      // Defensive guard — always true here: rebuild() above always sets the
      // handle, and the disabled/empty cases bail at the deferred-block gate.
      if (_trees.handle() !== null) {
        cityState.decorationRevision.value++;
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

  // Clear the internal layout cache. The caller (world.resetCache) layers the
  // ad-panel disposal on top. The layout cache is the only internal cache, so
  // this is equivalent to invalidateLayoutCache(); both are kept because the
  // caller delegates two distinct entry points to them. Does NOT touch the
  // cross-boundary signals: layout stays, so rootStreet/gemWorldPos stay valid.
  function resetCaches(): void {
    internal.cachedLayoutTreeSig = null;
    internal.cachedLayout = null;
  }

  // Clear only the layout cache (cachedLayout + its tree_signature key). A
  // config-only Save calls this before re-applying the same manifest, forcing
  // the next apply onto the non-reuse path (new layout reference → scenic
  // effects rebuild).
  function invalidateLayoutCache(): void {
    internal.cachedLayoutTreeSig = null;
    internal.cachedLayout = null;
  }

  return { applyManifest, resetCaches, invalidateLayoutCache };
}
