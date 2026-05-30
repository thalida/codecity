import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@preact/signals';
import { persistAtomPerSource } from '@/state/persist';
import { CURRENT_SOURCE_KEY } from '@/state/runtime/sourceContext';

describe('persistAtomPerSource', () => {
  beforeEach(() => {
    localStorage.clear();
    CURRENT_SOURCE_KEY.value = null;
  });

  it('writes to localStorage under the active source key', () => {
    const store = signal<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);

    CURRENT_SOURCE_KEY.value = 'abc';
    store.value = { path: '/foo' };

    expect(localStorage.getItem('cc.source.abc.selection')).toBe(JSON.stringify({ path: '/foo' }));
  });

  it('hydrates from localStorage when source key changes', () => {
    const store = signal<{ path: string } | null>(null);
    localStorage.setItem('cc.source.xyz.selection', JSON.stringify({ path: '/bar' }));
    persistAtomPerSource('selection', store, null);

    CURRENT_SOURCE_KEY.value = 'xyz';
    expect(store.value).toEqual({ path: '/bar' });
  });

  it('falls back to default when new key has no entry', () => {
    const store = signal<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);
    CURRENT_SOURCE_KEY.value = 'newkey';
    expect(store.value).toBeNull();
  });

  it('does nothing when source key is null', () => {
    const store = signal<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);
    store.value = { path: '/foo' };
    // No source key set — nothing should be in localStorage under any
    // cc.source.* key.
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('cc.source.'));
    expect(keys).toEqual([]);
  });

  it('saves to old key, hydrates new key when CURRENT_SOURCE_KEY changes', () => {
    const store = signal<{ path: string } | null>(null);
    persistAtomPerSource('selection', store, null);

    CURRENT_SOURCE_KEY.value = 'first';
    store.value = { path: '/A' };

    // Pre-seed the second source's slot.
    localStorage.setItem('cc.source.second.selection', JSON.stringify({ path: '/B' }));

    CURRENT_SOURCE_KEY.value = 'second';
    expect(store.value).toEqual({ path: '/B' });
    // First source's slot still has /A.
    expect(localStorage.getItem('cc.source.first.selection')).toBe(JSON.stringify({ path: '/A' }));
  });
});
