import { describe, it, expect, beforeEach } from 'vitest';
import { pushRecent, removeRecent, RECENTS } from '@/state/stores/source';
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

  it('recovers gracefully from corrupt storage', () => {
    localStorage.setItem(STORAGE_PREFIX + PERSISTED_KEYS.RECENTS, '{not valid json');
    expect(RECENTS.value).toEqual([]);
    // And pushing still works.
    pushRecent({ src: '/foo', label: 'foo' });
    expect(RECENTS.value).toHaveLength(1);
  });
});
