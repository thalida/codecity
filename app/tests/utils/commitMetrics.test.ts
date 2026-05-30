import { describe, it, expect } from 'vitest';
import { sameDayCommitCount } from '@/utils/commitMetrics';
import type { CommitEntry } from '@/types';

function commit(date: string, sha: string, files = 1): CommitEntry {
  return { date, sha, files, authors: ['Test Author'], subject: 'test commit' };
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
