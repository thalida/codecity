// scene/fireflies/fireflies.ts — Fireflies subsystem orchestrator.
// Thin pass-through from TreePlacement[] + commits to a renderer
// lifecycle handle. Mirrors trees/trees.ts.

import * as THREE from 'three';
import { placeFireflies, type FireflyPlacement } from './firefliesPlacement.js';
import { createFireflyRenderer, type FireflyRenderer } from './firefliesRenderer.js';
import { createOrbitRings } from './orbitRings.js';
import type { TreePlacement } from '@/scene/components/trees/treePlacement.js';
import type { CommitEntry } from '@/types';
import { FIREFLIES } from '@/config/components/fireflies.js';

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
  if (!FIREFLIES.get().FIREFLIES_ENABLED) {
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
    },
    setHoveredCommit(sha: string | null) {
      if (sha === null) {
        renderer.setHoveredCommit(null);
      } else {
        const idx = shaToIndex.get(sha);
        renderer.setHoveredCommit(idx !== undefined ? idx : null);
      }
    },
    setSelectedCommit(sha: string | null) {
      if (sha === null) {
        renderer.setSelectedCommit(null);
      } else {
        const idx = shaToIndex.get(sha);
        renderer.setSelectedCommit(idx !== undefined ? idx : null);
      }
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
