// city/state/index.ts — the per-city manifest-bound store: signals + the async
// manifest pipeline that advances them. Per-instance (NOT a module singleton —
// tests construct multiple cities).
//
//   manifest / layout — SOURCE signals, reassigned EVERY apply. layout carries
//     fresh per-building dims; the dims-dependent components (buildings/footprint/
//     trees) rebuild off it. latestWorldBounds is a source signal set on non-reuse
//     (getWorldBounds reads WORLD; a `computed` would over-subscribe).
//   structureRevision / cityRevision / decorationRevision — change-notification
//     counters; consumers track them and peek the data.
//   bbox / sceneBbox / cityHeight / rootStreet / gemWorldPos — COMPUTED, never
//     written. bbox = union of street rects + building footprints + footprint halo.
//
// applyManifest + invalidateLayoutCache are defined here (the store owns its
// transition); every scene component rebuilds reactively off the signals above.
import { signal, computed, batch, type Signal, type ReadonlySignal } from '@preact/signals';
import * as THREE from 'three';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import type { CityBbox, CityLayout, Manifest, Street } from '@/types';
import { getWorldBounds, type WorldBounds } from '../utils/floorBounds';
import { rectOfStreet } from '@/city/layout/rect';
import type { TreePlacement } from '../components/trees/treePlacement';
import { gemAnchorXZ } from '@/city/components/gem/anchor';
import { buildIconAtlas } from '../components/buildings/atlas';
import { setIconAtlas } from '../components/buildings/material';
import { setCellIconAtlas } from '../components/buildings/cellMesh';
import { labelFromManifest } from '@/utils/sources';
import type { createLayoutClient, LayoutComputeOpts } from '../layout';

export interface CityState {
  manifest: Signal<Manifest | null>;
  // Full layout (positions + per-building dims), reassigned EVERY apply — feeds
  // the dims-dependent rebuilds (buildings/footprint/trees) + the bbox computed.
  layout: Signal<CityLayout | null>;
  // Structure-change tick: bumped ONLY on a non-reuse apply. The structure-
  // reactive consumers (rootStreet/bbox/streets) track this and peek `layout`, so
  // they rebuild on a real structure change and skip a reuse apply natively
  // (layout itself reassigns every apply, so it is NOT a skip signal).
  structureRevision: Signal<number>;
  // World bbox (street rects + building footprints + footprint halo). Off
  // structureRevision → frozen on a reuse apply; the cameraRig framing tracks it.
  readonly bbox: ReadonlySignal<THREE.Box3 | null>;
  // Placement-space view of bbox (CityLayout's XY = world XZ); for tree placement.
  readonly sceneBbox: ReadonlySignal<CityBbox | null>;
  // City vertical extent (bbox.max.y - min.y); feeds worldBounds.
  readonly cityHeight: ReadonlySignal<number>;
  latestWorldBounds: Signal<WorldBounds | null>;
  // Deferred tree-placement results: trees writes (null at rebuild start, the
  // array once the off-thread scan resolves); fireflies reacts off it.
  treePlacements: Signal<TreePlacement[] | null>;
  readonly rootStreet: ReadonlySignal<Street | null>;
  readonly gemWorldPos: ReadonlySignal<THREE.Vector3 | null>;
  // Rebuild-notification counters (replace the old world.onChange observer).
  //   cityRevision — bumped ONCE per apply, in the manifest/layout batch. "The
  //     city rebuilt; re-derive": the picker clears hover + re-resolves its
  //     selection key, pathLine recomputes (the streets-by-dir map is fresh by
  //     then), buildingFader re-sweeps the fresh iFade buffers. (cameraRig
  //     reframes off bbox, NOT this — bbox changes on structure changes only.)
  //   decorationRevision — bumped by the trees component when its meshes change:
  //     once when it CLEARS (so the picker drops stale tree pickables) and again
  //     when the deferred trees attach (so the picker re-resolves a Commit
  //     selection + includes the live tree meshes). fireflies tracks treePlacements.
  cityRevision: Signal<number>;
  decorationRevision: Signal<number>;
  // The async manifest pipeline cityState owns: compute the layout off-thread,
  // then set the source signals (every component rebuilds reactively off them).
  applyManifest(newManifest: Manifest | { tree: unknown; [k: string]: unknown }): Promise<void>;
  // Clears the private layout cache, forcing the next apply onto the non-reuse path.
  invalidateLayoutCache(): void;
}

export function createCityState(layoutClient: ReturnType<typeof createLayoutClient>): CityState {
  const manifest = signal<Manifest | null>(null);
  const layout = signal<CityLayout | null>(null);
  const structureRevision = signal(0);
  const latestWorldBounds = signal<WorldBounds | null>(null);
  const treePlacements = signal<TreePlacement[] | null>(null);
  const cityRevision = signal(0);
  const decorationRevision = signal(0);

  // Footprint halo width in world units, or 0 when the halo is off. Dedupes to a
  // number so bbox (below) re-fires only when the halo actually changes — not on
  // every FOOTPRINT change (e.g. COLOR), which would spuriously reframe/refit.
  const footprintHalo = computed<number>(() => {
    const f = FOOTPRINT.value;
    return f.ENABLED && f.HALO_WIDTH > 0 ? f.HALO_WIDTH : 0;
  });

  // World bbox. Tracks structureRevision (recomputes on a structure change only,
  // so it's frozen on a reuse apply → cameraRig/island skip via the computed's
  // memoization) and peeks `layout` for the data. Street-rect bounds == the built
  // street group's bounds (sidewalk stadium reaches exactly ±length/2, ±width/2),
  // so this reproduces the old setFromObject(streets.group) result + footprints.
  const bbox = computed<THREE.Box3 | null>(() => {
    void structureRevision.value;
    const l = layout.peek();
    if (!l) return null;
    const box = new THREE.Box3();
    for (const s of l.streets) {
      const r = rectOfStreet(s);
      box.expandByPoint(new THREE.Vector3(r.x - r.w / 2, 0, r.y - r.d / 2));
      box.expandByPoint(new THREE.Vector3(r.x + r.w / 2, 0, r.y + r.d / 2));
    }
    // Empty fallback (no streets) — matches the old NaN-guard, applied BEFORE the
    // building expansion so a building-only layout still gets the floor box.
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
    }
    // Buildings render via a separate instanced mesh — expand to each footprint
    // + Y height so framing covers the FULL visible city.
    for (const b of l.buildings) {
      box.expandByPoint(new THREE.Vector3(b.x - b.w / 2, 0, b.y - b.d / 2));
      box.expandByPoint(new THREE.Vector3(b.x + b.w / 2, b.h, b.y + b.d / 2));
    }
    // Expand XZ by the halo so the bbox covers the asphalt slab wrapping the city
    // (footprint rects are inflated by HALO_WIDTH). Y stays bounded by height.
    const halo = footprintHalo.value;
    if (halo > 0) {
      box.min.x -= halo;
      box.min.z -= halo;
      box.max.x += halo;
      box.max.z += halo;
    }
    return box;
  });

  // Placement-space view of the world bbox (CityLayout's XY axis == world XZ).
  const sceneBbox = computed<CityBbox | null>(() => {
    const b = bbox.value;
    if (!b) return null;
    return {
      minX: b.min.x,
      maxX: b.max.x,
      minY: b.min.z,
      maxY: b.max.z,
      cx: (b.min.x + b.max.x) / 2,
      cy: (b.min.z + b.max.z) / 2,
      width: b.max.x - b.min.x,
      depth: b.max.z - b.min.z,
    };
  });
  const cityHeight = computed<number>(() => {
    const b = bbox.value;
    return b ? b.max.y - b.min.y : 0;
  });

  // The root-of-repo street (gets the gem) — the first isRoot street. Tracks
  // structureRevision + peeks layout, so it stays ref-stable on a reuse apply
  // (gem/cameraRig skip) and recomputes only on a structure change.
  const rootStreet = computed<Street | null>(() => {
    void structureRevision.value;
    return (layout.peek()?.streets ?? []).filter((s) => s.isRoot)[0] || null;
  });

  // Gem world position: the floor-level (y=0) anchor at the open (gem) end of
  // the root street. The XZ anchor comes from gemAnchorXZ — the one source of
  // this geometry, shared with the gem mesh + tree placement.
  const gemWorldPos = computed<THREE.Vector3 | null>(() => {
    const root = rootStreet.value;
    if (!root) return null;
    const a = gemAnchorXZ(root);
    return new THREE.Vector3(a.x, 0, a.y);
  });

  // --- The manifest pipeline. Manifest-bound caches (layout cache + tree
  // signatures + generation) are private here; generation gives supersession
  // (a newer call wins, an older one bails at its post-await checks). ---
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
    const friendlyName = labelFromManifest(newManifestTyped);
    if (newManifestTyped.tree && friendlyName) {
      newManifestTyped.tree.name = friendlyName;
    }

    // Icon atlas is expensive (a fetch+draw per unique icon), so rebuild it only
    // when the structure-only tree_signature changes (settings re-applies skip).
    // Must run BEFORE the layout signal fires the reactive buildings rebuild, so
    // the cells bake the right roof UVs.
    const atlasTreeSig = newManifestTyped.tree_signature ?? '';
    if (atlasTreeSig !== lastAtlasTreeSig) {
      try {
        const atlas = await buildIconAtlas(newManifestTyped);
        if (myGeneration !== generation) return; // superseded mid-build
        lastAtlasTreeSig = atlasTreeSig;
        setIconAtlas(atlas);
        setCellIconAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    // Compute the layout off-thread. Cache key = the structure-only tree_signature
    // (paths + nesting, NO mtime/size — stable across skeleton/final for one scan).
    const treeSig = newManifestTyped.tree_signature ?? '';
    const reuseFrom = treeSig && cachedLayoutTreeSig === treeSig ? cachedLayout : null;
    const computeOpts: LayoutComputeOpts = reuseFrom ? { reuseLayoutFrom: reuseFrom } : {};
    let newLayout: CityLayout;
    // Full envelope, not `.tree` — the layout code unwraps it and the worker
    // contract stays typed against Manifest. 'superseded' = a newer apply took
    // over; return silently and let it own the swap.
    try {
      newLayout = await layoutClient.compute(newManifestTyped, computeOpts);
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    // Reuse = a cache hit (worker reused the prior layout, identical positions).
    // We bump structureRevision ONLY on non-reuse, so the structure-reactive
    // consumers + the bbox computed stay frozen on a reuse apply (the scenic skip).
    const reused = reuseFrom !== null;
    if (treeSig) {
      cachedLayoutTreeSig = treeSig;
      cachedLayout = newLayout;
    }
    if (myGeneration !== generation) return;

    // One batch so the reactive consumers settle on a single change. manifest +
    // layout reassign every apply; structureRevision bumps ONLY on non-reuse;
    // cityRevision bumps once so picker/pathLine/buildingFader re-derive together.
    // layout is set before structureRevision so structure consumers peek the fresh
    // layout when they re-run.
    batch(() => {
      manifest.value = newManifestTyped;
      layout.value = newLayout;
      if (!reused) structureRevision.value++;
      cityRevision.value++;
    });

    // latestWorldBounds is a source signal (getWorldBounds reads WORLD), set only
    // on non-reuse so the island doesn't re-fit on a reuse apply. bbox + the rest
    // are computeds off structureRevision — frozen on reuse automatically.
    if (!reused) {
      latestWorldBounds.value = getWorldBounds(sceneBbox.value, cityHeight.value);
    }
  }

  // A config-only Save calls this before re-applying the same manifest, forcing
  // the next apply onto the non-reuse path. Does NOT touch the signals.
  function invalidateLayoutCache(): void {
    cachedLayoutTreeSig = null;
    cachedLayout = null;
  }

  return {
    manifest,
    layout,
    structureRevision,
    bbox,
    sceneBbox,
    cityHeight,
    latestWorldBounds,
    treePlacements,
    rootStreet,
    gemWorldPos,
    cityRevision,
    decorationRevision,
    applyManifest,
    invalidateLayoutCache,
  };
}
