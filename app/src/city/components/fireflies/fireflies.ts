// city/components/fireflies/fireflies.ts — Fireflies subsystem orchestrator.
// Thin assembly from TreePlacement[] + commits to a renderer lifecycle
// handle (orbs + orbit rings). The persistent component door is ./index.ts.

import * as THREE from 'three';
import { placeFireflies, type FireflyPlacement } from './firefliesPlacement';
import { createFireflyRenderer, type FireflyRenderer } from './firefliesRenderer';
import { createOrbitRings } from './orbitRings';
import type { TreePlacement } from '@/city/components/trees/treePlacement';
import type { CommitEntry } from '@/types';
import { FIREFLIES } from '@/state/stores/settings/fireflies';

/** Public handle returned by createFireflies. Extends the renderer with
 *  sha-based hover/select methods so callers don't need to manage the
 *  sha→index map externally. */
export interface Fireflies {
  group: FireflyRenderer['group'];
  setTime: FireflyRenderer['setTime'];
  /** Highlight fireflies for the commit with this sha. Pass null to clear. */
  setHoveredCommit(sha: string | null): void;
  /** Select-highlight fireflies for the commit with this sha. Pass null to clear. */
  setSelectedCommit(sha: string | null): void;
  /** Update LineMaterial resolution uniform on canvas resize. */
  onResize(width: number, height: number): void;
  refresh: FireflyRenderer['refresh'];
  dispose: FireflyRenderer['dispose'];
}

export function createFireflies(
  placements: TreePlacement[],
  commits: CommitEntry[] | null
): Fireflies {
  const parent = new THREE.Group();
  parent.name = 'fireflies-system';

  // Master config gate. When disabled, return an empty parent group so the
  // caller's group is still safe to add/dispose.
  if (!FIREFLIES.value.ENABLED) {
    const stub = createFireflyRenderer([]);
    return {
      group: parent,
      setTime: stub.setTime.bind(stub),
      setHoveredCommit() {},
      setSelectedCommit() {},
      onResize() {},
      refresh: stub.refresh.bind(stub),
      dispose: stub.dispose.bind(stub),
    };
  }
  const orbs: FireflyPlacement[] = placeFireflies(placements, commits ?? []);
  const rings = createOrbitRings(orbs);
  const renderer = createFireflyRenderer(orbs);

  // Rings render first so orbs (additive) composite on top.
  parent.add(rings.group);
  parent.add(renderer.group);

  // Build sha → commitIndex map once at construction time.
  const shaToIndex = new Map<string, number>();
  (commits ?? []).forEach((c, i) => shaToIndex.set(c.sha, i));

  return {
    group: parent,
    setTime(seconds: number) {
      renderer.setTime(seconds);
      // Piggyback on the per-frame setTime tick to advance the orbit-ring
      // rainbow chase on selected commits. rings.update wants milliseconds
      // (matches treeOutlineRenderer's `performance.now() * RAINBOW.SPEED`
      // convention); convert from the seconds the renderer was passed.
      rings.update(seconds * 1000);
    },
    setHoveredCommit(sha: string | null) {
      const idx = sha === null ? null : (shaToIndex.get(sha) ?? null);
      renderer.setHoveredCommit(idx);
      rings.setHoveredCommit(idx);
    },
    setSelectedCommit(sha: string | null) {
      const idx = sha === null ? null : (shaToIndex.get(sha) ?? null);
      renderer.setSelectedCommit(idx);
      rings.setSelectedCommit(idx);
    },
    onResize(width: number, height: number) {
      rings.onResize(width, height);
    },
    refresh() {
      renderer.refresh();
      rings.refresh();
    },
    dispose() {
      rings.dispose();
      renderer.dispose();
    },
  };
}
