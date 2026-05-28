// scene/fireflies/fireflies.ts — Fireflies subsystem orchestrator.
// Thin pass-through from TreePlacement[] + commits to a renderer
// lifecycle handle. Mirrors trees/trees.ts.

import { placeFireflies, type FireflyPlacement } from './firefliesPlacement.js';
import { createFireflyRenderer, type FireflyRenderer } from './firefliesRenderer.js';
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
  refresh: FireflyRenderer['refresh'];
  dispose: FireflyRenderer['dispose'];
}

export function createFireflies(
  placements: TreePlacement[],
  commits: CommitEntry[] | null
): Fireflies {
  // Master config gate. When disabled, return an empty renderer so the
  // caller's group is still safe to add/dispose.
  if (!FIREFLIES.get().FIREFLIES_ENABLED) {
    const stub = createFireflyRenderer([]);
    return {
      group: stub.group,
      setTime: stub.setTime.bind(stub),
      setHoveredCommit() {},
      setSelectedCommit() {},
      refresh: stub.refresh.bind(stub),
      dispose: stub.dispose.bind(stub),
    };
  }
  const orbs: FireflyPlacement[] = placeFireflies(placements, commits ?? []);
  const renderer = createFireflyRenderer(orbs);

  // Build sha → commitIndex map once at construction time.
  const shaToIndex = new Map<string, number>();
  (commits ?? []).forEach((c, i) => shaToIndex.set(c.sha, i));

  return {
    group: renderer.group,
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
    refresh() {
      renderer.refresh();
    },
    dispose() {
      renderer.dispose();
    },
  };
}
