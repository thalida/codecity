import { describe, it, expect, beforeEach } from 'vitest';
import { atom } from 'nanostores';
import { persistAtomPerSource } from '@/utils/persist.js';
import { CURRENT_SOURCE_KEY } from '@/state/sourceContext.js';

describe('persistAtomPerSource', () => {
  beforeEach(() => {
    localStorage.clear();
    CURRENT_SOURCE_KEY.set(null);
  });

  it('writes to localStorage under the active source key', () => {
    const store = atom<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);

    CURRENT_SOURCE_KEY.set('abc');
    store.set({ path: '/foo' });

    expect(localStorage.getItem('cc.source.abc.selection')).toBe(
      JSON.stringify({ path: '/foo' })
    );
  });

  it('hydrates from localStorage when source key changes', () => {
    const store = atom<{ path: string } | null>(null);
    localStorage.setItem(
      'cc.source.xyz.selection',
      JSON.stringify({ path: '/bar' })
    );
    persistAtomPerSource('selection', store, null);

    CURRENT_SOURCE_KEY.set('xyz');
    expect(store.get()).toEqual({ path: '/bar' });
  });

  it('falls back to default when new key has no entry', () => {
    const store = atom<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);
    CURRENT_SOURCE_KEY.set('newkey');
    expect(store.get()).toBeNull();
  });

  it('does nothing when source key is null', () => {
    const store = atom<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);
    store.set({ path: '/foo' });
    // No source key set — nothing should be in localStorage under any
    // cc.source.* key.
    const keys = Object.keys(localStorage).filter(k => k.startsWith('cc.source.'));
    expect(keys).toEqual([]);
  });

  it('saves to old key, hydrates new key when CURRENT_SOURCE_KEY changes', () => {
    const store = atom<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);

    CURRENT_SOURCE_KEY.set('first');
    store.set({ path: '/A' });

    // Pre-seed the second source's slot.
    localStorage.setItem(
      'cc.source.second.selection',
      JSON.stringify({ path: '/B' })
    );

    CURRENT_SOURCE_KEY.set('second');
    expect(store.get()).toEqual({ path: '/B' });
    // First source's slot still has /A.
    expect(localStorage.getItem('cc.source.first.selection')).toBe(
      JSON.stringify({ path: '/A' })
    );
  });
});
