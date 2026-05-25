import { describe, it, expect, beforeEach } from 'vitest';
import { sameDayCommitCount, treeColorForCommit } from '@/views/widgets/commitMetrics.js';
import { TREES } from '@/config/components/trees.js';
import type { CommitEntry } from '@/types';

function commit(date: string, sha: string, files = 1): CommitEntry {
  return { date, sha, files };
}

function resetTrees() {
  TREES.set({
    TREES_ENABLED: true,
    EDGE_INSET_PERCENT: 8,
    TREE_DENSITY_FALLOFF: 0,
    TREE_MIN_HEIGHT: 48,
    TREE_MAX_HEIGHT: 144,
    TREE_MIN_WIDTH: 32,
    TREE_MAX_WIDTH: 128,
    TRUNK_HEIGHT_FRAC: 0.25,
    TRUNK_RADIUS_FRAC_OF_CANOPY: 0.15,
    CANOPY_TRUNK_OVERLAP_FRAC: 0.7,
    SCATTER_FOOTPRINT_FRAC_OF_MAX_WIDTH: 0.5,
    TREE_COLOR_OLD: '#0a2613',
    TREE_COLOR_NEW: '#a8d68a',
    TREE_SHADING_STRENGTH: 0.65,
    TREE_TRUNK_COLOR: '#120c08',
  });
}

describe('sameDayCommitCount', () => {
  it('counts a single commit on its date', () => {
    const target = commit('2026-03-12', 'a'.repeat(40));
    const all = [target, commit('2026-03-11', 'b'.repeat(40))];
    expect(sameDayCommitCount(target, all)).toBe(1);
  });

  it('counts multiple commits sharing the same date', () => {
    const target = commit('2026-03-12', 'a'.repeat(40));
    const all = [
      commit('2026-03-12', 'b'.repeat(40)),
      target,
      commit('2026-03-12', 'c'.repeat(40)),
      commit('2026-03-11', 'd'.repeat(40)),
    ];
    expect(sameDayCommitCount(target, all)).toBe(3);
  });

  it('returns 0 when target.date is absent from the list', () => {
    const target = commit('2026-03-12', 'a'.repeat(40));
    expect(sameDayCommitCount(target, [commit('2026-03-11', 'b'.repeat(40))])).toBe(0);
  });
});

describe('treeColorForCommit', () => {
  beforeEach(resetTrees);

  it('returns a hex color string', () => {
    const target = commit('2026-03-12', 'a'.repeat(40));
    const result = treeColorForCommit(target, [target]);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns the same color for any commit sharing a date with the same daily count', () => {
    const a = commit('2026-03-12', 'a'.repeat(40));
    const b = commit('2026-03-12', 'b'.repeat(40));
    const c = commit('2026-03-12', 'c'.repeat(40));
    const all = [a, b, c];
    expect(treeColorForCommit(a, all)).toBe(treeColorForCommit(b, all));
    expect(treeColorForCommit(b, all)).toBe(treeColorForCommit(c, all));
  });

  it('returns different colors for solo-commit days vs busy days', () => {
    const solo = commit('2026-03-12', 'a'.repeat(40));
    const busyA = commit('2026-03-15', 'b'.repeat(40));
    const busyB = commit('2026-03-15', 'c'.repeat(40));
    const busyC = commit('2026-03-15', 'd'.repeat(40));
    const all = [solo, busyA, busyB, busyC];
    expect(treeColorForCommit(solo, all)).not.toBe(treeColorForCommit(busyA, all));
  });

  it('falls back gracefully when the commit is not found in the list', () => {
    const orphan = commit('2026-04-01', 'f'.repeat(40));
    const others = [commit('2026-03-12', 'a'.repeat(40))];
    expect(treeColorForCommit(orphan, others)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
