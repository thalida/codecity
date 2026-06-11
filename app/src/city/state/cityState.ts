// city/state/cityState.ts — per-city manifest-bound state held in signals. Replaces the
// old mutable cityState bag that was passed by reference with a "never
// destructure-copy" warning: with signals there's no separable field value to
// copy and let go stale — readers hold the signal and read .value, writers set
// .value, the signal reference never gets reassigned. Per-instance (NOT a module
// singleton — tests construct multiple cities).
//
// Only the SIX fields the world accessors read live here (the cross-boundary
// surface). The other manifest-bound mirrors/caches (street mesh arrays, cell
// mirrors, layout/atlas/scenic caches, generation counter) are never read by an
// accessor, so they stay private inside createApplyManifest's closure.
//
//   manifest / layout / bbox / latestWorldBounds — SOURCE signals; applyManifest
//     sets .value. (bbox is computed imperatively from the built street group +
//     building footprints + footprint halo — NOT pure off layout — so it stays a
//     source signal. latestWorldBounds derives via getWorldBounds, which reads
//     WORLD.value; making it `computed` would subscribe to WORLD = new
//     reactivity, so it stays a source signal set imperatively too.)
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
}

export function createCityState(): CityState {
  const manifest = signal<Manifest | null>(null);
  const layout = signal<CityLayout | null>(null);
  const bbox = signal<THREE.Box3 | null>(null);
  const latestWorldBounds = signal<WorldBounds | null>(null);

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

  return { manifest, layout, bbox, latestWorldBounds, rootStreet, gemWorldPos };
}
