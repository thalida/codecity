// city/state/applyManifest.ts — the manifest build/rebuild pipeline factory.
// createApplyManifest(deps) returns { applyManifest, invalidateLayoutCache }.
//
// State split:
//   - Cross-boundary signals (manifest/layout/bbox/latestWorldBounds +
//     rootStreet/gemWorldPos computeds) live in `cityState` (./index);
//     applyManifest sets the source signals' .value.
//   - Manifest-bound caches no accessor reads (the layout cache + its
//     tree_signature key, the icon-atlas tree_signature, the generation
//     counter) are private to this closure (the `internal` object).

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
// across applyManifest calls; the layout cache is nulled by invalidateLayoutCache().
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
  // Clears the layout cache (cachedLayout + its tree_signature key), forcing the
  // next apply onto the non-reuse path.
  invalidateLayoutCache: () => void;
}

export function createApplyManifest(deps: ApplyManifestDeps): ApplyManifestApi {
  const { components, scene, layoutClient, treePlacementClient, cityState } = deps;
  // gem/island/repoLabel/streets rebuild reactively off cityState signals, so
  // they aren't driven from here. These five are: buildings/footprint must
  // rebuild even on a layout-reuse apply (dims change), and buildings/trees/
  // fireflies are async/deferred. _streets is grabbed only to read its
  // freshly-rebuilt group for the bbox.
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

  // Loosely typed: some tests pass mock manifests with string `type` fields
  // instead of the 'directory'/'file' literals. Real callers pass Manifests.
  async function applyManifest(
    newManifest: Manifest | { tree: unknown; [k: string]: unknown }
  ): Promise<void> {
    const myGeneration = ++internal.generation;
    const newManifestTyped = newManifest as Manifest;

    // Rewrite tree.name to the friendly label BEFORE building so every downstream
    // consumer (labels, footer, title) shows it instead of the cache-dir hash.
    const _friendlyName = labelFromManifest(newManifestTyped);
    if (newManifestTyped.tree && _friendlyName) {
      newManifestTyped.tree.name = _friendlyName;
    }

    // Icon atlas is expensive (a fetch+draw per unique icon), so rebuild it only
    // when the structure-only tree_signature changes (settings re-applies skip).
    // Must run before the cell pass so buildings sample the right glyphs.
    const _atlasTreeSig = newManifestTyped.tree_signature ?? '';
    if (_atlasTreeSig !== internal.lastAtlasTreeSig) {
      try {
        const atlas = await buildIconAtlas(newManifestTyped);
        if (myGeneration !== internal.generation) return; // superseded mid-build
        internal.lastAtlasTreeSig = _atlasTreeSig;
        // Into the shared material before _buildings.rebuild reads it.
        _buildings.setAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    // Compute the layout off-thread. Cache key = the structure-only
    // tree_signature (paths + nesting, NO mtime/size — stable across
    // skeleton/final for one scan). A newer apply preempts via a 'superseded'
    // rejection.
    const _treeSig = newManifestTyped.tree_signature ?? '';
    const _reuseFrom =
      _treeSig && internal.cachedLayoutTreeSig === _treeSig ? internal.cachedLayout : null;
    const _layoutComputeOpts: LayoutComputeOpts = _reuseFrom ? { reuseLayoutFrom: _reuseFrom } : {};
    let newLayout: CityLayout;
    // Full envelope, not `.tree` — the layout code unwraps it and the worker
    // contract stays typed against Manifest. 'superseded' = a newer apply took
    // over; return silently and let it own the swap.
    try {
      newLayout = await layoutClient.compute(newManifestTyped, _layoutComputeOpts);
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    // THE SCENIC-SKIP MECHANISM: a cache hit means the worker reused the prior
    // layout (identical positions). On `reused` we do NOT reassign the
    // layout/bbox/latestWorldBounds signals below, so the reactive scenic
    // effects (streets/gem/island/repoLabel) keep their stable references and
    // skip natively; the existing meshes stay correct.
    const reused = _reuseFrom !== null;
    // Cache the layout for the next call (keyed by tree_signature).
    if (_treeSig) {
      internal.cachedLayoutTreeSig = _treeSig;
      internal.cachedLayout = newLayout;
    }
    if (myGeneration !== internal.generation) return;

    // Date ranges come off the manifest (backend-computed, like busyness);
    // _buildings.rebuild uses them for per-building color/age.
    const newDateRanges: DateRanges = newManifestTyped.dateRanges;
    if (myGeneration !== internal.generation) return;

    // Buildings rebuild on BOTH branches — not reuse-gated, not reactive: the
    // rebuild is async and needs the date ranges, and per-building dims recompute
    // every apply (so even a reuse apply must rebuild). Atlas is already set.
    await _buildings.rebuild(newLayout, newDateRanges);

    // Clear trees/fireflies BEFORE the cityRevision bump so the picker's pickable
    // refresh sees no stale tree meshes; the deferred pass rebuilds them and
    // bumps decorationRevision for a second refresh.
    _trees.clear();
    _fireflies.clear();

    // One batch so the reactive consumers settle on a single change. manifest
    // reassigns every apply; layout ONLY on non-reuse (stable ref on reuse = the
    // scenic skip). cityRevision bumps once so picker/cameraRig/pathLine/
    // buildingFader re-derive together; by batch-close the synchronous scenic
    // effects (streets/gem) have rebuilt, so _streets.group + the streets-by-dir
    // map (read via this bump) are already fresh.
    batch(() => {
      cityState.manifest.value = newManifestTyped;
      // layout reassigns EVERY apply (fresh per-building dims) — feeds the
      // dims-dependent rebuilds (buildings/footprint) + the bbox below.
      cityState.layout.value = newLayout;
      // layoutStructure reassigns ONLY on non-reuse (positions) — ref-stable on
      // reuse so the structure-reactive consumers (streets/gem/island) skip.
      if (!reused) cityState.layoutStructure.value = newLayout;
      cityState.cityRevision.value++;
    });

    if (!reused) {
      // _streets.group is populated by the reactive streets effect at batch-close.
      // bbox over the street meshes ONLY — not setFromObject(scene), which would
      // fold in sky/island/gem/footprint. Empty fallback avoids NaN at boot.
      const bbox = new THREE.Box3().setFromObject(_streets.group);
      if (bbox.isEmpty()) {
        bbox.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
      }
      // Buildings render via a separate instanced mesh (not in _streets.group),
      // so expand to each building's XZ footprint + Y height — downstream framing
      // needs the FULL visible city.
      for (const b of newLayout.buildings) {
        bbox.expandByPoint(new THREE.Vector3(b.x - b.w / 2, 0, b.y - b.d / 2));
        bbox.expandByPoint(new THREE.Vector3(b.x + b.w / 2, b.h, b.y + b.d / 2));
      }
      // Expand XZ by the footprint halo so the bbox covers the asphalt slab
      // wrapping the city (layout rects are inflated by HALO_WIDTH). Y stays
      // bounded by building height so cityHeight isn't inflated.
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
    // On reuse: bbox + latestWorldBounds (below, also reuse-gated) stay from the
    // last non-reuse apply (same positions), so the island/camera effects don't
    // re-fire.

    // Trees are deferred to the next frame so the city paints + becomes
    // interactive BEFORE the placement scan + GPU upload block the main thread
    // (a multi-hundred-ms freeze on large repos otherwise).
    const treesEnabled = TREES.value.ENABLED;

    // The expanded bbox, as a placement-style CityBbox for tree placement below.
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
    // Vertical extent — feeds worldBounds so small-but-tall repos still get an
    // airy floor buffer relative to building height.
    const cityHeight = bbox ? bbox.max.y - bbox.min.y : 0;

    // latestWorldBounds drives the island. Reassign only on non-reuse (the island
    // effect re-fires); on reuse the reference stays stable (no resize flash).
    // getWorldBounds falls back to a small origin default when there's no city.
    if (!reused) {
      cityState.latestWorldBounds.value = getWorldBounds(sceneBbox, cityHeight);
    }

    if (bbox) {
      // Footprint rebuilds every apply (NOT reactive): building dims recompute
      // even on a reuse apply, so the slabs must re-match. Cheap — no defer.
      _footprint.rebuild(newLayout);
    }

    if (treesEnabled && bbox && sceneBbox) {
      // Snapshot what the deferred pass needs so a later apply can't race it.
      const generationAtDefer = myGeneration;
      const layoutAtDefer = newLayout;
      const commitCountAtDefer = cityState.manifest.value!.commits?.length ?? 0;
      const cityHeightAtDefer = cityHeight;
      const foliageBbox: CityBbox = sceneBbox;

      REBUILD_STATUS.value = RebuildStatus.Decorating;
      // rAF starts the next frame; the setTimeout(0) then yields so the browser
      // can COMPLETE the paint before foliage work begins.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
      if (generationAtDefer !== internal.generation) return;

      // Off-thread placement; 'superseded' rejects if a newer apply fires mid-flight.
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

      // Second notify now that trees are attached: the cityRevision bump fired
      // before this deferred block, when no tree meshes existed, so the picker
      // couldn't include trees / re-resolve a Commit selection. The guard is
      // always true here (rebuild set the handle; empty/disabled bail earlier).
      if (_trees.handle() !== null) {
        cityState.decorationRevision.value++;
      }

      REBUILD_STATUS.value = RebuildStatus.Idle;
    } else {
      // No deferred pass (trees disabled or empty bbox) → no async work to await,
      // so clear the status here; otherwise a caller that set it to Rebuilding
      // (useCityScene live-update, settings rebuild) would leave the footer dot
      // stuck yellow. Superseded applies returned earlier and never reach here.
      REBUILD_STATUS.value = RebuildStatus.Idle;
    }
  }

  // A config-only Save calls this before re-applying the same manifest, forcing
  // the next apply onto the non-reuse path (new layout reference → scenic
  // effects rebuild). Does NOT touch the signals — layout stays valid.
  function invalidateLayoutCache(): void {
    internal.cachedLayoutTreeSig = null;
    internal.cachedLayout = null;
  }

  return { applyManifest, invalidateLayoutCache };
}
