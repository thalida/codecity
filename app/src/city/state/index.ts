// city/state/index.ts — per-city manifest-bound state held in signals.
// Per-instance (NOT a module singleton — tests construct multiple cities).
// Readers hold a signal and read .value; writers set .value; the signal
// reference is never reassigned.
//
//   manifest / layout / bbox / latestWorldBounds — SOURCE signals; applyManifest
//     sets .value. (bbox is computed imperatively from the built street group +
//     building footprints + footprint halo, NOT pure off layout. latestWorldBounds
//     derives via getWorldBounds, which reads WORLD.value; making it `computed`
//     would subscribe to WORLD, so it stays a source signal set imperatively.)
//   rootStreet / gemWorldPos — COMPUTED off layout; never written. rootStreet is
//     the first isRoot street; gemWorldPos is its gem anchor (orientation-aware).
import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import * as THREE from 'three';
import type { CityBbox, CityLayout, Manifest, Street } from '@/types';
import type { WorldBounds } from '../utils/floorBounds';
import type { TreePlacement } from '../components/trees/treePlacement';
import { gemAnchorXZ } from '@/city/components/gem/anchor';

export interface CityState {
  manifest: Signal<Manifest | null>;
  // Full layout (positions + per-building dims), reassigned EVERY apply. (Set
  // alongside layoutStructure today; becomes the every-apply source in Stage 8.)
  layout: Signal<CityLayout | null>;
  // Positions only, reassigned ONLY on a non-reuse apply — its ref-stability on
  // reuse is the scenic-skip for the structure-reactive components.
  layoutStructure: Signal<CityLayout | null>;
  bbox: Signal<THREE.Box3 | null>;
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
}

export function createCityState(): CityState {
  const manifest = signal<Manifest | null>(null);
  const layout = signal<CityLayout | null>(null);
  const layoutStructure = signal<CityLayout | null>(null);
  const bbox = signal<THREE.Box3 | null>(null);
  const latestWorldBounds = signal<WorldBounds | null>(null);
  const treePlacements = signal<TreePlacement[] | null>(null);
  const cityRevision = signal(0);
  const decorationRevision = signal(0);

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

  return {
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
}
