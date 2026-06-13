// city/state/index.ts — per-city manifest-bound state held in signals.
// Per-instance (NOT a module singleton — tests construct multiple cities).
// Readers hold a signal and read .value; writers set .value; the signal
// reference is never reassigned.
//
//   manifest / layout / layoutStructure — SOURCE signals; applyManifest sets
//     .value. latestWorldBounds is a source signal set on non-reuse (it derives
//     via getWorldBounds, which reads WORLD; a `computed` would over-subscribe).
//   bbox / sceneBbox / cityHeight / rootStreet / gemWorldPos — COMPUTED, never
//     written. bbox is the union of street rects + building footprints + the
//     footprint halo, off layoutStructure (so it's frozen on a reuse apply, like
//     the framing was; the computed's memoization is the scenic-skip). rootStreet
//     is the first isRoot street; gemWorldPos is its gem anchor.
import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import * as THREE from 'three';
import { FOOTPRINT } from '@/state/stores/settings/footprint';
import type { CityBbox, CityLayout, Manifest, Street } from '@/types';
import type { WorldBounds } from '../utils/floorBounds';
import { rectOfStreet } from '@/city/layout/rect';
import type { TreePlacement } from '../components/trees/treePlacement';
import { gemAnchorXZ } from '@/city/components/gem/anchor';
import type { createLayoutClient } from '../layout';
import { createApplyManifest } from './applyManifest';

export interface CityState {
  manifest: Signal<Manifest | null>;
  // Full layout (positions + per-building dims), reassigned EVERY apply. (Set
  // alongside layoutStructure today; becomes the every-apply source in Stage 8.)
  layout: Signal<CityLayout | null>;
  // Positions only, reassigned ONLY on a non-reuse apply — its ref-stability on
  // reuse is the scenic-skip for the structure-reactive components.
  layoutStructure: Signal<CityLayout | null>;
  // World bbox (street rects + building footprints + footprint halo), off
  // layoutStructure → frozen on a reuse apply; the cameraRig framing tracks it.
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
  //   cityRevision      — bumped ONCE per applyManifest, in the same batch() as
  //     manifest/layout. Means "the city rebuilt; re-derive" — picker clears
  //     hover + re-resolves its selection key, cameraRig reframes (it actually
  //     tracks bbox, which changes in lockstep), pathLine recomputes (the
  //     streets-by-dir map is fresh by the time this bumps), buildingFader
  //     re-sweeps the fresh iFade buffers.
  //   decorationRevision — bumped AFTER the deferred trees/fireflies attach
  //     (replaces the old second onChange emit). Means "foliage now present" —
  //     the picker re-resolves a Commit selection + refreshes pickables with the
  //     live tree meshes (the first bump fired before trees existed).
  cityRevision: Signal<number>;
  decorationRevision: Signal<number>;
  // The async manifest pipeline cityState owns: compute the layout off-thread,
  // then set the source signals (every component rebuilds reactively off them).
  applyManifest(newManifest: Manifest | { tree: unknown; [k: string]: unknown }): Promise<void>;
  // Clears the private layout cache, forcing the next apply onto the non-reuse path.
  invalidateLayoutCache(): void;
}

/** The signals/computeds half of CityState — what the manifest pipeline reads
 *  and writes. createCityState builds these, then spreads the pipeline API in. */
export type CityStateSignals = Omit<CityState, 'applyManifest' | 'invalidateLayoutCache'>;

export function createCityState(layoutClient: ReturnType<typeof createLayoutClient>): CityState {
  const manifest = signal<Manifest | null>(null);
  const layout = signal<CityLayout | null>(null);
  const layoutStructure = signal<CityLayout | null>(null);
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

  // World bbox off layoutStructure (frozen on reuse → cameraRig/island skip via
  // the computed's memoization). Street-rect bounds == the built street group's
  // bounds (sidewalk stadium reaches exactly ±length/2, ±width/2), so this
  // reproduces the old setFromObject(streets.group) result without reading meshes.
  const bbox = computed<THREE.Box3 | null>(() => {
    const l = layoutStructure.value;
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

  // The root-of-repo street (gets the gem) — the first isRoot street. Off
  // layoutStructure (positions), so it stays ref-stable on a reuse apply and
  // gem/cameraRig skip; recomputes only on a structure change.
  const rootStreet = computed<Street | null>(
    () => (layoutStructure.value?.streets ?? []).filter((s) => s.isRoot)[0] || null
  );

  // Gem world position: the floor-level (y=0) anchor at the open (gem) end of
  // the root street. The XZ anchor comes from gemAnchorXZ — the one source of
  // this geometry, shared with the gem mesh + tree placement.
  const gemWorldPos = computed<THREE.Vector3 | null>(() => {
    const root = rootStreet.value;
    if (!root) return null;
    const a = gemAnchorXZ(root);
    return new THREE.Vector3(a.x, 0, a.y);
  });

  const signals: CityStateSignals = {
    manifest,
    layout,
    layoutStructure,
    bbox,
    sceneBbox,
    cityHeight,
    latestWorldBounds,
    treePlacements,
    rootStreet,
    gemWorldPos,
    cityRevision,
    decorationRevision,
  };
  // cityState owns the manifest pipeline: build it over these signals and spread
  // its API (applyManifest + invalidateLayoutCache) into the returned object.
  return { ...signals, ...createApplyManifest(signals, layoutClient) };
}
