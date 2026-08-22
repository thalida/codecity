// city/components/fireflies/firefliesScrub.ts — the orb field at a scrub
// position: how much of the work is this author's SO FAR, and an orbit on a tree
// that is itself younger here. Placements are resized in place, so the hover
// rings read the same numbers when one is built.

import type { CommitEntry, RepoStats } from '@/types';
import { TREES } from '@/state/settings/fields/trees';
import { FIREFLIES } from '@/state/settings/fields/fireflies';
import {
  computeSizeRange,
  treeHeight,
  treeRadius,
  type AgeMoment,
} from '@/city/components/trees/treeEncoding';
import { epochDayAt } from '@/utils/dates';
import { scaleForCommits, type FireflyPlacement } from './firefliesPlacement';

export interface FirefliesScrub {
  /** The commit in effect and the date. Either null restores the live sizes;
   *  the return says whether anything moved, so uploads stay rare. */
  resize(maxCommitIndex: number | null, nowMs: number | null): boolean;
}

export function createFirefliesScrub(
  orbs: FireflyPlacement[],
  commits: CommitEntry[] | null,
  stats: RepoStats | null | undefined
): FirefliesScrub {
  const history = commits ?? [];
  // The busiest author's all-time total, the fixed maximum sizes are read
  // against, so an orb grows through the scrub instead of holding its rank.
  const maxCommits = stats?.authors?.[0]?.commits ?? 0;
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
    resize(maxCommitIndex: number | null, nowMs: number | null): boolean {
      if (maxCommitIndex === null || nowMs === null) return restore();

      const day = epochDayAt(nowMs);
      if (maxCommitIndex === _appliedCommit && day === _appliedDay) return false;
      _appliedCommit = maxCommitIndex;
      _appliedDay = day;

      countTo(Math.min(maxCommitIndex, history.length - 1));
      const cfgFireflies = FIREFLIES.value;
      const scales = new Map<string, number>();
      for (const [author, n] of counts) {
        scales.set(author, scaleForCommits(n, maxCommits, cfgFireflies));
      }
      // Nobody has committed until they have: an author still ahead of their
      // first commit sits at the floor, not at the size they end up.
      const unstarted = scaleForCommits(0, maxCommits, cfgFireflies);

      // Tree sizes at this date, from the same formulas the forest grows by, so
      // an orb keeps its place just outside the canopy.
      const cfg = TREES.value;
      const scrubbed: AgeMoment = day;
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
        orb.scale = scales.get(orb.author) ?? unstarted;
        orb.height = orb.heightFrac * height;
        orb.orbitRadius = orb.orbitRadiusFrac * (radiusAt.get(orb.commitIndex) ?? 0);
      }
      return true;
    },
  };
}
