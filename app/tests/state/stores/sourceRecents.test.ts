import { describe, it, expect, beforeEach } from 'vitest';
import { pushRecent, removeRecent, RECENTS } from '@/state/stores/recents';
import { STORAGE_PREFIX, PERSISTED_KEYS } from '@/constants/storage';

describe('sourceRecents', () => {
  beforeEach(() => {
    localStorage.clear();
    // RECENTS hydrated at module load — reset in-memory value to match
    // the cleared storage so each test starts from an empty list.
    RECENTS.value = [];
  });

  it('starts empty', () => {
    expect(RECENTS.value).toEqual([]);
  });

  it('push appends an entry', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    const list = RECENTS.value;
    expect(list).toHaveLength(1);
    expect(list[0].src).toBe('/foo');
    expect(list[0].label).toBe('foo');
    expect(list[0].lastOpenedAt).toBeGreaterThan(0);
  });

  it('push dedups by (src, branch) and re-sorts MRU', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: '/bar', label: 'bar' });
    pushRecent({ src: '/foo', label: 'foo' }); // duplicate
    const list = RECENTS.value;
    expect(list).toHaveLength(2);
    expect(list[0].src).toBe('/foo'); // moved to MRU
  });

  it('treats different branches as distinct entries for a remote source', () => {
    pushRecent({ src: 'https://x/r', branch: 'main', label: 'x/r' });
    pushRecent({ src: 'https://x/r', branch: 'dev', label: 'x/r' });
    expect(RECENTS.value).toHaveLength(2);
  });

  it('caps at 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      pushRecent({ src: `/s${i}`, label: `s${i}` });
    }
    expect(RECENTS.value).toHaveLength(10);
    // Last one pushed should be at the top.
    expect(RECENTS.value[0].src).toBe('/s14');
  });

  it('removeRecent drops the matching entry', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: '/bar', label: 'bar' });
    removeRecent('/foo');
    expect(RECENTS.value).toHaveLength(1);
    expect(RECENTS.value[0].src).toBe('/bar');
  });

  it('removeRecent matches branch too', () => {
    pushRecent({ src: 'https://x/r', branch: 'main', label: 'x/r' });
    pushRecent({ src: 'https://x/r', branch: 'dev', label: 'x/r' });
    removeRecent('https://x/r', 'main');
    expect(RECENTS.value).toHaveLength(1);
    expect(RECENTS.value[0].branch).toBe('dev');
  });

  it('keeps the checkout off identity, so one path stays one row across branches', () => {
    // Worktrees of one repo all label as owner/repo, so the checkout is what
    // tells them apart; in identity it would split one path into a row each.
    pushRecent({ src: '/repo', label: 'owner/repo', checkout: 'main' });
    pushRecent({ src: '/repo', label: 'owner/repo', checkout: 'feature' });
    expect(RECENTS.value).toHaveLength(1);
    expect(RECENTS.value[0].checkout).toBe('feature');
  });

  it('keeps two worktrees of one repo apart, since their paths differ', () => {
    pushRecent({ src: '/repo', label: 'owner/repo', checkout: 'main' });
    pushRecent({ src: '/repo/.wt/feature', label: 'owner/repo', checkout: 'feature' });
    expect(RECENTS.value.map((r) => r.checkout)).toEqual(['feature', 'main']);
  });

  it('recovers gracefully from corrupt storage', () => {
    localStorage.setItem(STORAGE_PREFIX + PERSISTED_KEYS.RECENTS, '{not valid json');
    expect(RECENTS.value).toEqual([]);
    // And pushing still works.
    pushRecent({ src: '/foo', label: 'foo' });
    expect(RECENTS.value).toHaveLength(1);
  });
});
