// city/components/fireflies/firefliesScrub.ts — resize the orb field to a scrub
// position. An orb says two things, and the timeline moves both: how much of
// the repo's work is this author's (their share of the commits made SO FAR, not
// of the whole history), and where the orbit sits (on a tree that is itself
// younger and smaller at this date).
//
// Placements are mutated in place rather than rebuilt: the orbit rings read
// them when a hover builds a ring, so both halves stay on one set of numbers.

import type { CommitEntry, RepoStats } from '@/types';
import { TREES } from '@/state/stores/settings/trees';
import { FIREFLIES } from '@/state/stores/settings/fireflies';
import {
  computeAgeRange,
  computeSizeRange,
  treeHeight,
  treeRadius,
  type AgeRange,
} from '@/city/components/trees/treeEncoding';
import { scaleByAuthor, type FireflyPlacement } from './firefliesPlacement';

const DAY_MS = 86_400_000;

export interface FirefliesScrub {
  /** The last commit in effect, and the date the scrub sits on. Either null
   *  (Live) restores the sizes the placements were built with. Returns whether
   *  anything moved, so the renderer only re-uploads when it did. */
  apply(maxCommitIndex: number | null, nowMs: number | null): boolean;
}

export function createFirefliesScrub(
  orbs: FireflyPlacement[],
  commits: CommitEntry[] | null,
  stats: RepoStats | null | undefined,
  scannedAt?: string | null
): FirefliesScrub {
  const history = commits ?? [];
  const ageRange = computeAgeRange(stats, scannedAt);
  const sizeRange = computeSizeRange(stats);
  // The sizes the placements were built with, to restore on the way back to
  // Live without recomputing them and drifting by a rounding step.
  const live = orbs.map((o) => ({ scale: o.scale, height: o.height, radius: o.orbitRadius }));

  // Commits [0..cursor] are counted. Scrubbing walks it, so a frame costs the
  // commits crossed rather than a pass over the whole history.
  const counts = new Map<string, number>();
  let cursor = -1;

  function credit(index: number, delta: number): void {
    for (const author of history[index]?.authors ?? []) {
      counts.set(author, (counts.get(author) ?? 0) + delta);
    }
  }

  function countTo(index: number): void {
    while (cursor < index) credit(++cursor, 1);
    while (cursor > index) credit(cursor--, -1);
  }

  let _appliedCommit: number | null = null;
  let _appliedDay: number | null = null;

  function restore(): boolean {
    if (_appliedCommit === null && _appliedDay === null) return false;
    for (let i = 0; i < orbs.length; i++) {
      orbs[i].scale = live[i].scale;
      orbs[i].height = live[i].height;
      orbs[i].orbitRadius = live[i].radius;
    }
    _appliedCommit = null;
    _appliedDay = null;
    return true;
  }

  return {
    apply(maxCommitIndex: number | null, nowMs: number | null): boolean {
      if (maxCommitIndex === null || nowMs === null) return restore();

      const day = nowMs / DAY_MS;
      if (maxCommitIndex === _appliedCommit && day === _appliedDay) return false;
      _appliedCommit = maxCommitIndex;
      _appliedDay = day;

      countTo(Math.min(maxCommitIndex, history.length - 1));
      // Authors who haven't committed yet are not in the ranking: an orb of
      // theirs isn't drawn at this position either.
      const working: [string, number][] = [];
      for (const [author, n] of counts) if (n > 0) working.push([author, n]);
      const scales = scaleByAuthor(working, FIREFLIES.value);

      // Tree sizes at this date, from the same formulas the forest grows by, so
      // an orb keeps its place just outside the canopy.
      const cfg = TREES.value;
      const scrubbed: AgeRange = { ...ageRange, scanned: day };
      const heightAt = new Map<number, number>();
      const radiusAt = new Map<number, number>();

      for (let i = 0; i < orbs.length; i++) {
        const orb = orbs[i];
        let height = heightAt.get(orb.commitIndex);
        if (height === undefined) {
          const commit = history[orb.commitIndex] ?? null;
          height = treeHeight(commit, scrubbed, cfg);
          heightAt.set(orb.commitIndex, height);
          radiusAt.set(orb.commitIndex, treeRadius(commit, scrubbed, sizeRange, cfg));
        }
        orb.scale = scales.get(orb.author) ?? live[i].scale;
        orb.height = orb.heightFrac * height;
        orb.orbitRadius = orb.orbitRadiusFrac * (radiusAt.get(orb.commitIndex) ?? 0);
      }
      return true;
    },
  };
}
