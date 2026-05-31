import { describe, it, expect, beforeEach } from 'vitest';
import { perSourceSignal, savePerSourceState, loadPerSourceState } from '@/state/persist';
import { CURRENT_SOURCE_KEY } from '@/state/runtime/activeSource';

// Per-source persistence is now EXPLICIT: callers call
// savePerSourceState(oldKey) before switching, then loadPerSourceState(newKey)
// after — no auto-sync on CURRENT_SOURCE_KEY change. Tests exercise that
// explicit timing model.

describe('perSourceSignal + savePerSourceState/loadPerSourceState', () => {
  beforeEach(() => {
    localStorage.clear();
    CURRENT_SOURCE_KEY.value = null;
  });

  it('writes to localStorage under the active source key on savePerSourceState', () => {
    const store = perSourceSignal<{ path: string } | null>('selection', null);

    store.value = { path: '/foo' };
    savePerSourceState('abc');

    expect(localStorage.getItem('cc.source.abc.selection')).toBe(JSON.stringify({ path: '/foo' }));
  });

  it('hydrates from localStorage on loadPerSourceState', () => {
    const store = perSourceSignal<{ path: string } | null>('selection', null);
    localStorage.setItem('cc.source.xyz.selection', JSON.stringify({ path: '/bar' }));

    loadPerSourceState('xyz');
    expect(store.value).toEqual({ path: '/bar' });
  });

  it('falls back to default when the loaded key has no entry', () => {
    const store = perSourceSignal<{ path: string } | null>('selection', null);
    store.value = { path: '/stale' }; // dirty the signal so we can verify the reset

    loadPerSourceState('newkey');
    expect(store.value).toBeNull();
  });

  it('does nothing when sourceKey is null on save', () => {
    const store = perSourceSignal<{ path: string } | null>('selection', null);
    store.value = { path: '/foo' };

    savePerSourceState(null);

    const keys = Object.keys(localStorage).filter((k) => k.startsWith('cc.source.'));
    expect(keys).toEqual([]);
  });

  it('save then load round-trip preserves value across an explicit switch', () => {
    const store = perSourceSignal<{ path: string } | null>('selection', null);

    // Source A holds /A.
    store.value = { path: '/A' };
    savePerSourceState('first');

    // Pre-seed source B's slot.
    localStorage.setItem('cc.source.second.selection', JSON.stringify({ path: '/B' }));

    // Switch: save current (already saved), then load new.
    loadPerSourceState('second');
    expect(store.value).toEqual({ path: '/B' });

    // First source's slot is intact.
    expect(localStorage.getItem('cc.source.first.selection')).toBe(JSON.stringify({ path: '/A' }));
  });
});
