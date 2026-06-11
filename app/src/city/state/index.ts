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
import type { CityLayout, Manifest, Street } from '@/types';
import type { WorldBounds } from '../utils/floorBounds';
import { gemAnchorXZ } from '@/city/components/gem/anchor';

export interface CityState {
  manifest: Signal<Manifest | null>;
  layout: Signal<CityLayout | null>;
  bbox: Signal<THREE.Box3 | null>;
  latestWorldBounds: Signal<WorldBounds | null>;
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
  const bbox = signal<THREE.Box3 | null>(null);
  const latestWorldBounds = signal<WorldBounds | null>(null);
  const cityRevision = signal(0);
  const decorationRevision = signal(0);

  // The root-of-repo street (gets the gem) — the first isRoot street in the
  // current layout. Recomputes when layout.value changes.
  const rootStreet = computed<Street | null>(
    () => (layout.value?.streets ?? []).filter((s) => s.isRoot)[0] || null
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
    bbox,
    latestWorldBounds,
    rootStreet,
    gemWorldPos,
    cityRevision,
    decorationRevision,
  };
}
