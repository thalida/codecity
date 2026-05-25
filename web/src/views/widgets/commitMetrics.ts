// views/widgets/commitMetrics.ts — pure helpers for per-commit UI metrics
// used by the commit pane and (eventually) other views.
//
// All functions are side-effect-free: they read from nanostores atoms only
// when computing the color, and never mutate any global state.

import * as THREE from 'three';
import type { CommitEntry } from '@/types';
import { TREES } from '@/config/components/trees.js';
import {
  computeDailyCounts,
  dailyCountTByIndex,
} from '@/scene/components/trees/treeEncoding.js';
import { interpolateOklch } from '@/scene/components/trees/colorInterp.js';

/** Count of commits whose date matches `commit.date` (includes `commit` itself). */
export function sameDayCommitCount(commit: CommitEntry, commits: CommitEntry[]): number {
  return commits.filter(c => c.date === commit.date).length;
}

// Reusable scratch objects — allocate once so repeated calls don't GC-pressure.
const _oldColor = new THREE.Color();
const _newColor = new THREE.Color();
const _tmpColor = new THREE.Color();

/** CSS hex color (e.g. "#5e8a3a") for a commit, matching the tree-renderer's
 *  per-tree color formula:
 *    interpolateOklch(TREE_COLOR_NEW, TREE_COLOR_OLD, dailyCountTByIndex(...))
 *  Reads TREE_COLOR_OLD + TREE_COLOR_NEW from the TREES config atom internally. */
export function treeColorForCommit(commit: CommitEntry, commits: CommitEntry[]): string {
  const cfg = TREES.get();

  // Mirror treeRenderer.ts: setColorFromHex uses LinearSRGBColorSpace.
  _oldColor.setStyle(cfg.TREE_COLOR_OLD, THREE.LinearSRGBColorSpace);
  _newColor.setStyle(cfg.TREE_COLOR_NEW, THREE.LinearSRGBColorSpace);

  const idx = commits.findIndex(c => c.sha === commit.sha);
  let t = 0.5; // neutral fallback when commit isn't found
  if (idx >= 0) {
    const dailyCounts = computeDailyCounts(commits);
    t = dailyCountTByIndex(dailyCounts, idx);
  }

  // ORDER matches treeRenderer.ts perTreeColor: interpolateOklch(newColor, oldColor, t, target)
  interpolateOklch(_newColor, _oldColor, t, _tmpColor);

  return '#' + _tmpColor.getHexString();
}
