// city/state/applyManifest.ts — the manifest build/rebuild pipeline. cityState
// owns this (createCityState wires it in); it's the async action that advances
// the city from a new manifest: compute the layout off-thread, then set the
// source signals. Every scene component rebuilds reactively off those signals —
// this action drives no components. The manifest-bound caches (layout cache +
// tree_signatures + generation) are private to this closure.

import { batch } from '@preact/signals';

import { buildIconAtlas } from '../components/buildings/atlas';
import { setIconAtlas } from '../components/buildings/material';
import { setCellIconAtlas } from '../components/buildings/cellMesh';
import { labelFromManifest } from '@/utils/sources';
import type { createLayoutClient } from '../layout';
import type { LayoutComputeOpts } from '../layout';
import { getWorldBounds } from '../utils/floorBounds';
import type { CityStateSignals } from './index';
import type { CityLayout, Manifest } from '@/types';

export interface ApplyManifestApi {
  applyManifest: (newManifest: Manifest | { tree: unknown; [k: string]: unknown }) => Promise<void>;
  // Clears the layout cache (cachedLayout + its tree_signature key), forcing the
  // next apply onto the non-reuse path.
  invalidateLayoutCache: () => void;
}

/** Build the manifest pipeline over cityState's signals. `s` is the signals
 *  half of cityState (createCityState spreads this back in alongside the API). */
export function createApplyManifest(
  s: CityStateSignals,
  layoutClient: ReturnType<typeof createLayoutClient>
): ApplyManifestApi {
  // Manifest-bound caches no accessor reads. generation: each call captures its
  // own value and bails once a newer call has advanced past it (supersession).
  let cachedLayoutTreeSig: string | null = null;
  let cachedLayout: CityLayout | null = null;
  let lastAtlasTreeSig: string | null = null;
  let generation = 0;

  // Loosely typed: some tests pass mock manifests with string `type` fields
  // instead of the 'directory'/'file' literals. Real callers pass Manifests.
  async function applyManifest(
    newManifest: Manifest | { tree: unknown; [k: string]: unknown }
  ): Promise<void> {
    const myGeneration = ++generation;
    const newManifestTyped = newManifest as Manifest;

    // Rewrite tree.name to the friendly label BEFORE building so every downstream
    // consumer (labels, footer, title) shows it instead of the cache-dir hash.
    const _friendlyName = labelFromManifest(newManifestTyped);
    if (newManifestTyped.tree && _friendlyName) {
      newManifestTyped.tree.name = _friendlyName;
    }

    // Icon atlas is expensive (a fetch+draw per unique icon), so rebuild it only
    // when the structure-only tree_signature changes (settings re-applies skip).
    // Must run BEFORE the layout signal fires the reactive buildings rebuild, so
    // the cells bake the right roof UVs.
    const _atlasTreeSig = newManifestTyped.tree_signature ?? '';
    if (_atlasTreeSig !== lastAtlasTreeSig) {
      try {
        const atlas = await buildIconAtlas(newManifestTyped);
        if (myGeneration !== generation) return; // superseded mid-build
        lastAtlasTreeSig = _atlasTreeSig;
        setIconAtlas(atlas);
        setCellIconAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    // Compute the layout off-thread. Cache key = the structure-only tree_signature
    // (paths + nesting, NO mtime/size — stable across skeleton/final for one scan).
    // A newer apply preempts via a 'superseded' rejection.
    const _treeSig = newManifestTyped.tree_signature ?? '';
    const _reuseFrom = _treeSig && cachedLayoutTreeSig === _treeSig ? cachedLayout : null;
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
    // layout (identical positions). On `reused` we do NOT reassign layoutStructure
    // (or latestWorldBounds), so the structure-reactive consumers + the bbox
    // computed keep their stable references and skip natively.
    const reused = _reuseFrom !== null;
    if (_treeSig) {
      cachedLayoutTreeSig = _treeSig;
      cachedLayout = newLayout;
    }
    if (myGeneration !== generation) return;

    // One batch so the reactive consumers settle on a single change. manifest +
    // layout reassign every apply (layout carries fresh per-building dims for the
    // dims-dependent rebuilds); layoutStructure ONLY on non-reuse (the scenic
    // skip). cityRevision bumps once so picker/cameraRig/pathLine/buildingFader
    // re-derive together.
    batch(() => {
      s.manifest.value = newManifestTyped;
      s.layout.value = newLayout;
      if (!reused) s.layoutStructure.value = newLayout;
      s.cityRevision.value++;
    });

    // bbox (+ sceneBbox/cityHeight) is a computed off layoutStructure — frozen on
    // reuse. latestWorldBounds is a source signal (getWorldBounds reads WORLD), set
    // only on non-reuse so the island doesn't re-fit on a reuse apply.
    if (!reused) {
      s.latestWorldBounds.value = getWorldBounds(s.sceneBbox.value, s.cityHeight.value);
    }
  }

  // A config-only Save calls this before re-applying the same manifest, forcing
  // the next apply onto the non-reuse path. Does NOT touch the signals.
  function invalidateLayoutCache(): void {
    cachedLayoutTreeSig = null;
    cachedLayout = null;
  }

  return { applyManifest, invalidateLayoutCache };
}
