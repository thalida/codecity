import { describe, it, expect, beforeEach } from 'vitest';
import { listRecents, pushRecent, removeRecent } from '@/state/runtime/sourceRecents';

describe('sourceRecents', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(listRecents()).toEqual([]);
  });

  it('push appends an entry', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    const list = listRecents();
    expect(list).toHaveLength(1);
    expect(list[0].src).toBe('/foo');
    expect(list[0].label).toBe('foo');
    expect(list[0].lastOpenedAt).toBeGreaterThan(0);
  });

  it('push dedups by (src, branch) and re-sorts MRU', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: '/bar', label: 'bar' });
    pushRecent({ src: '/foo', label: 'foo' }); // duplicate
    const list = listRecents();
    expect(list).toHaveLength(2);
    expect(list[0].src).toBe('/foo'); // moved to MRU
  });

  it('treats different branches as distinct entries', () => {
    pushRecent({ src: 'https://x/r', branch: 'main', label: 'x/r' });
    pushRecent({ src: 'https://x/r', branch: 'dev', label: 'x/r' });
    expect(listRecents()).toHaveLength(2);
  });

  it('caps at 10 entries', () => {
    for (let i = 0; i < 15; i++) {
      pushRecent({ src: `/s${i}`, label: `s${i}` });
    }
    expect(listRecents()).toHaveLength(10);
    // Last one pushed should be at the top.
    expect(listRecents()[0].src).toBe('/s14');
  });

  it('removeRecent drops the matching entry', () => {
    pushRecent({ src: '/foo', label: 'foo' });
    pushRecent({ src: '/bar', label: 'bar' });
    removeRecent('/foo');
    expect(listRecents()).toHaveLength(1);
    expect(listRecents()[0].src).toBe('/bar');
  });

  it('removeRecent matches branch too', () => {
    pushRecent({ src: 'https://x/r', branch: 'main', label: 'x/r' });
    pushRecent({ src: 'https://x/r', branch: 'dev', label: 'x/r' });
    removeRecent('https://x/r', 'main');
    expect(listRecents()).toHaveLength(1);
    expect(listRecents()[0].branch).toBe('dev');
  });

  it('recovers gracefully from corrupt storage', () => {
    localStorage.setItem('codecity:recents', '{not valid json');
    expect(listRecents()).toEqual([]);
    // And pushing still works.
    pushRecent({ src: '/foo', label: 'foo' });
    expect(listRecents()).toHaveLength(1);
  });
});
