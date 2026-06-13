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
import type { Island } from '../components/island';
import { getWorldBounds } from '../utils/floorBounds';
import type { Footprint } from '../components/footprint';
import type { CityState } from './index';
import { SCENE } from '@/state/stores/settings/scene';
import type { CityLayout, Manifest } from '@/types';

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
  const { components, scene, layoutClient, cityState } = deps;
  // All scene components now rebuild reactively off cityState signals. One ref
  // remains: _buildings, only to push the icon atlas in BEFORE the layout signal
  // fires (so the reactive buildings rebuild bakes the right roof UVs).
  const { buildings: _buildings } = components;

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

    // bbox (+ sceneBbox/cityHeight) is now a computed off layoutStructure, so it
    // updates itself when the batch above reassigns layoutStructure (non-reuse)
    // and stays cached on reuse — no imperative bbox write here. Only the two
    // non-reactive non-reuse effects remain: the sky-color background and
    // latestWorldBounds (a source signal because getWorldBounds reads WORLD; on
    // reuse the stable bbox keeps the island from re-fitting).
    if (!reused) {
      scene.background = new THREE.Color(SCENE.value.SKY_COLOR);
      cityState.latestWorldBounds.value = getWorldBounds(
        cityState.sceneBbox.value,
        cityState.cityHeight.value
      );
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
