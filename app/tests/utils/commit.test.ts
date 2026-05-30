import { describe, it, expect } from 'vitest';
import { commitUrl, sameDayCommitCount } from '@/utils/commit';
import type { CommitEntry } from '@/types';

describe('commitUrl', () => {
  it('appends /commit/<sha> for a github URL', () => {
    expect(commitUrl('https://github.com/org/repo', 'a'.repeat(40))).toBe(
      `https://github.com/org/repo/commit/${'a'.repeat(40)}`
    );
  });

  it('works for a gitlab URL with subgroups', () => {
    expect(commitUrl('https://gitlab.com/group/sub/repo', 'b'.repeat(40))).toBe(
      `https://gitlab.com/group/sub/repo/commit/${'b'.repeat(40)}`
    );
  });

  it('works for bitbucket', () => {
    expect(commitUrl('https://bitbucket.org/org/repo', 'c'.repeat(40))).toBe(
      `https://bitbucket.org/org/repo/commit/${'c'.repeat(40)}`
    );
  });

  it('does not double-slash when the remote ends with /', () => {
    expect(commitUrl('https://github.com/org/repo/', 'd'.repeat(40))).toBe(
      `https://github.com/org/repo/commit/${'d'.repeat(40)}`
    );
  });

  it('returns null for an empty remote', () => {
    expect(commitUrl('', 'a'.repeat(40))).toBeNull();
  });

  it('returns null for an empty sha', () => {
    expect(commitUrl('https://github.com/org/repo', '')).toBeNull();
  });
});

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
