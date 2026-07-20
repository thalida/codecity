// city/state/index.ts — the per-city manifest-bound store: signals + the async
// manifest pipeline that advances them. Per-instance (NOT a module singleton —
// tests construct multiple cities).
//
//   manifest / layout — SOURCE signals, reassigned EVERY apply. layout carries
//     fresh per-building dims; the dims-dependent components (buildings/footprint/
//     trees) rebuild off it. treePlacements is a source signal trees writes.
//   structureRevision / cityRevision / decorationRevision — change-notification
//     counters; consumers track them and peek the data.
//   bbox / sceneBbox / cityHeight / latestWorldBounds / rootStreet / gemWorldPos /
//   tallestBuilding — COMPUTED, never written. bbox = union of street rects +
//     building footprints + footprint halo.
//
// applyManifest + invalidateLayoutCache are defined here (the store owns its
// transition); every scene component rebuilds reactively off the signals above.
import { signal, computed, batch, type Signal, type ReadonlySignal } from '@preact/signals';
import * as THREE from 'three';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import { StreetAxis } from '@/types';
import type { Building, CityBbox, CityLayout, Manifest, Street } from '@/types';
import { getWorldBounds, type WorldBounds } from '../utils/floorBounds';
import type { TreePlacement } from '../components/trees/treePlacement';
import { gemAnchorXZ } from '@/city/components/gem/anchor';
import { buildIconAtlas } from '../components/buildings/atlas';
import { setIconAtlas } from '../components/buildings/material';
import type { createLayoutClient } from '../layout';

export interface CityState {
  manifest: Signal<Manifest | null>;
  // Full layout (positions + per-building dims), reassigned EVERY apply — feeds
  // the dims-dependent rebuilds (buildings/footprint/trees) + the bbox computed.
  layout: Signal<CityLayout | null>;
  // World bbox (street rects + building footprints + footprint halo). Off
  // structureRevision → frozen on a reuse apply; the cameraRig framing tracks it.
  readonly bbox: ReadonlySignal<THREE.Box3 | null>;
  // Placement-space view of bbox (CityLayout's XY = world XZ); for tree placement.
  readonly sceneBbox: ReadonlySignal<CityBbox | null>;
  // City vertical extent (bbox.max.y - min.y); feeds worldBounds.
  readonly cityHeight: ReadonlySignal<number>;
  // Island floor sizing. Computed off sceneBbox + cityHeight (frozen on reuse),
  // null until the first apply.
  readonly latestWorldBounds: ReadonlySignal<WorldBounds | null>;
  // Deferred tree-placement results: trees writes (null at rebuild start, the
  // array once the off-thread scan resolves); fireflies reacts off it.
  treePlacements: Signal<TreePlacement[] | null>;
  readonly rootStreet: ReadonlySignal<Street | null>;
  readonly gemWorldPos: ReadonlySignal<THREE.Vector3 | null>;
  // Tallest building (by height) for the camera start-framing height-fit. From
  // layout data, not the async building meshes (see the computed).
  readonly tallestBuilding: ReadonlySignal<Building | null>;
  // { street dir.path → Street } from the layout. The buildings fader, pathLine,
  // picker, and the CityWorld debug API resolve a street by directory off this
  // instead of reaching into the streets component.
  readonly streetsByDirMap: ReadonlySignal<Record<string, Street>>;
  // --- Change-notification counters.
  // Consumers track a counter and peek the data; each bump means "re-derive."
  //   structureRevision — bumped ONLY on a non-reuse apply (positions/topology
  //     changed). The structure-reactive consumers (rootStreet/bbox/streets) track
  //     it + peek `layout`, so they rebuild on a structure change and skip a reuse
  //     apply. (layout reassigns every apply, so it is NOT itself a skip signal.)
  //   cityRevision — bumped ONCE on EVERY apply. The general "the city re-applied"
  //     tick: the picker clears hover + re-resolves its selection key, pathLine
  //     recomputes (streets-by-dir map is fresh by then), buildingFader re-sweeps
  //     the fresh iFade buffers. (cameraRig reframes off bbox, NOT this.)
  //   decorationRevision — bumped by the trees component when its meshes change:
  //     on CLEAR (picker drops stale tree pickables) and again on ATTACH (picker
  //     re-resolves a Commit selection + includes the live tree meshes). fireflies
  //     tracks treePlacements separately.
  structureRevision: Signal<number>;
  cityRevision: Signal<number>;
  decorationRevision: Signal<number>;
  // The async manifest pipeline cityState owns: compute the layout off-thread,
  // then set the source signals (every component rebuilds reactively off them).
  applyManifest(newManifest: Manifest): Promise<void>;
  // Forces the next apply onto the non-reuse path (rebuild for the same layout signature).
  invalidateLayoutCache(): void;
}

export function createCityState(layoutClient: ReturnType<typeof createLayoutClient>): CityState {
  const manifest = signal<Manifest | null>(null);
  const layout = signal<CityLayout | null>(null);
  const treePlacements = signal<TreePlacement[] | null>(null);
  // Change-notification counters (see CityState for what each means + who tracks it).
  const structureRevision = signal(0);
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
  // so this matches the built street group's bounds + footprints.
  const bbox = computed<THREE.Box3 | null>(() => {
    void structureRevision.value;
    const l = layout.peek();
    if (!l) return null;
    const box = new THREE.Box3();
    // Expand min/max directly instead of allocating a Vector3 + calling
    // expandByPoint per point: this runs over every street + building (~190k
    // points at Linux scale), so the inline form is ~2.4x faster and allocates
    // nothing (rectOfStreet's per-street object included). box starts at
    // +Inf/-Inf, so the first point seeds it; isEmpty() below still detects the
    // no-streets case. Equivalent to expandByPoint of each rect's two corners.
    const min = box.min;
    const max = box.max;
    for (const s of l.streets) {
      // rectOfStreet's orientation swap, inlined.
      const w = s.orientation === StreetAxis.X ? s.length : s.width;
      const d = s.orientation === StreetAxis.X ? s.width : s.length;
      const x0 = s.x - w / 2;
      const x1 = s.x + w / 2;
      const z0 = s.y - d / 2;
      const z1 = s.y + d / 2;
      if (x0 < min.x) min.x = x0;
      if (x1 > max.x) max.x = x1;
      if (z0 < min.z) min.z = z0;
      if (z1 > max.z) max.z = z1;
      if (0 < min.y) min.y = 0;
      if (0 > max.y) max.y = 0;
    }
    // Empty fallback (no streets) — applied BEFORE the building expansion so a
    // building-only layout still gets the floor box.
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 10, 50));
    }
    // Buildings render via a separate instanced mesh — expand to each footprint
    // (y=0) + roof height (y=b.h) so framing covers the FULL visible city.
    for (const b of l.buildings) {
      const x0 = b.x - b.w / 2;
      const x1 = b.x + b.w / 2;
      const z0 = b.y - b.d / 2;
      const z1 = b.y + b.d / 2;
      if (x0 < min.x) min.x = x0;
      if (x1 > max.x) max.x = x1;
      if (z0 < min.z) min.z = z0;
      if (z1 > max.z) max.z = z1;
      if (0 < min.y) min.y = 0;
      if (b.h < min.y) min.y = b.h;
      if (0 > max.y) max.y = 0;
      if (b.h > max.y) max.y = b.h;
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

  // Island floor sizing. Off sceneBbox + cityHeight (both frozen on a reuse apply
  // via structureRevision), so the island re-fits only on a structure change.
  // null until the first apply (no sceneBbox yet) — getWorldBounds is only called
  // with a real bbox. getWorldBounds reads WORLD.GROUND_BUFFER_PERCENT, WORLD's
  // only field + rebuild-routed, so that subscription never over-fires.
  const latestWorldBounds = computed<WorldBounds | null>(() => {
    const sb = sceneBbox.value;
    return sb ? getWorldBounds(sb, cityHeight.value) : null;
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

  // Tracks `layout` (every apply), NOT structureRevision: per-building dims
  // (incl. the worker's media-silhouette sizing) recompute on a reuse apply —
  // the skeleton→final swap turns placeholder heights real without bumping
  // structureRevision — so the height must refresh there. Reading the layout
  // directly also means framing never waits on the async building-mesh rebuild.
  const tallestBuilding = computed<Building | null>(() => {
    const l = layout.value;
    if (!l) return null;
    let tallest: Building | null = null;
    for (const b of l.buildings) {
      if (!tallest || b.h > tallest.h) tallest = b;
    }
    return tallest;
  });

  // Street lookup by directory path. Tracks structureRevision + peeks layout
  // (ref-stable on a reuse apply, recomputes on a structure change) — a
  // { dir.path → Street } map derived straight from layout.streets.
  const streetsByDirMap = computed<Record<string, Street>>(() => {
    void structureRevision.value;
    const map: Record<string, Street> = {};
    for (const s of layout.peek()?.streets ?? []) {
      if (s.dir?.path != null) map[s.dir.path] = s;
    }
    return map;
  });

  // --- The manifest pipeline. Private to this closure:
  //   lastAtlasTreeSig — tree_sig the icon atlas was last SUCCESSFULLY built for
  //     (lags the manifest if a build throws → retried next apply).
  //   invalidated — one-shot "force the next apply onto the non-reuse path",
  //     set by invalidateLayoutCache on a config Save.
  //   generation — supersession: a newer call wins; an older one bails at its
  //     post-await checks.
  // The reuse check compares against the committed manifest signal directly
  // (manifest.peek()) — no separate cache needed.
  let lastAtlasTreeSig: string | null = null;
  let invalidated = false;
  let generation = 0;

  async function applyManifest(newManifest: Manifest): Promise<void> {
    const myGeneration = ++generation;

    // Structure-only tree_signature (paths + nesting, NO mtime/size — stable
    // across skeleton/final for one scan). Gates ONLY the icon atlas rebuild
    // below; the layout reuse decision uses layout_signature instead (backend-
    // computed, also mixes in per-file size/dims).
    const treeSig = newManifest.tree_signature ?? '';

    // Icon atlas is expensive (a fetch+draw per unique icon), so rebuild it only
    // when treeSig changes (settings re-applies skip). Must run BEFORE the layout
    // signal fires the reactive buildings rebuild, so the cells bake the right UVs.
    if (treeSig !== lastAtlasTreeSig) {
      try {
        const atlas = await buildIconAtlas(newManifest);
        if (myGeneration !== generation) return; // superseded mid-build
        lastAtlasTreeSig = treeSig;
        setIconAtlas(atlas);
      } catch (err) {
        console.warn('[codecity] icon atlas build failed; roofs will render without icons', err);
      }
    }

    // Reuse the packed layout only when the packer's own inputs (structure +
    // per-file size, per the backend-computed layout_signature) are unchanged
    // — NOT merely the tree structure. A live content edit changes sizes, so
    // it takes the full re-pack path and streets/positions re-solve; a
    // dates-only change (or a settings re-apply of the identical manifest)
    // still reuses.
    const prev = manifest.peek();
    const prevLayoutSig =
      prev && 'layout_signature' in prev ? (prev as Manifest).layout_signature : '';
    const shouldReuse =
      !invalidated && prevLayoutSig !== '' && newManifest.layout_signature === prevLayoutSig;
    invalidated = false;
    const reusedLayout = shouldReuse ? layout.peek() : null;
    let newLayout: CityLayout;
    // Full envelope, not `.tree` — the layout code unwraps it and the worker
    // contract stays typed against Manifest. 'superseded' = a newer apply took
    // over; return silently and let it own the swap.
    try {
      newLayout = await layoutClient.compute(newManifest, reusedLayout);
    } catch (err) {
      if (err instanceof Error && err.message === 'superseded') return;
      throw err;
    }
    if (myGeneration !== generation) return;

    // One batch so the reactive consumers settle on a single change. manifest +
    // layout reassign every apply; structureRevision bumps ONLY on a structure
    // change (!shouldReuse) → the structure-reactive consumers + the bbox computed
    // stay frozen on a reuse apply (the scenic skip). cityRevision bumps once so
    // picker/pathLine/buildingFader re-derive. layout is set before
    // structureRevision so structure consumers peek it fresh.
    batch(() => {
      manifest.value = newManifest;
      layout.value = newLayout;
      if (!shouldReuse) structureRevision.value++;
      cityRevision.value++;
    });
  }

  // A config-only Save calls this before re-applying the same manifest, forcing
  // the next apply onto the non-reuse path (so the scenic effects rebuild even
  // though the layout signature is unchanged). Does NOT touch the signals.
  function invalidateLayoutCache(): void {
    invalidated = true;
  }

  return {
    manifest,
    layout,
    bbox,
    sceneBbox,
    cityHeight,
    latestWorldBounds,
    treePlacements,
    rootStreet,
    gemWorldPos,
    tallestBuilding,
    streetsByDirMap,
    structureRevision,
    cityRevision,
    decorationRevision,
    applyManifest,
    invalidateLayoutCache,
  };
}
