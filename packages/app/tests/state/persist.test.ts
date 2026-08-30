import { describe, it, expect, beforeEach } from 'vitest';
import { persistedSignal } from '@/lib/persist';

beforeEach(() => {
  localStorage.clear();
});

describe('persistedSignal — whole mode (dynamic-key Record)', () => {
  it('persists a runtime key not present in the default', () => {
    const s = persistedSignal<Record<string, string[]>>('wholeTest', {}, { whole: true });
    s.value = { ...s.value, runtimeHash: ['a', 'b'] };

    const raw = localStorage.getItem('cc.wholeTest');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ runtimeHash: ['a', 'b'] });
  });

  it('hydrates a runtime key back on reconstruction (survives reload)', () => {
    // First "session": write then implicitly persist via the effect.
    const first = persistedSignal<Record<string, string[]>>('wholeTest', {}, { whole: true });
    first.value = { ...first.value, runtimeHash: ['x'] };

    // Second "session": a fresh signal on the same key reads localStorage.
    const second = persistedSignal<Record<string, string[]>>('wholeTest', {}, { whole: true });
    expect(second.value).toEqual({ runtimeHash: ['x'] });
  });

  it('removes the slot when the value returns to the (empty) default', () => {
    const s = persistedSignal<Record<string, string[]>>('wholeTest', {}, { whole: true });
    s.value = { runtimeHash: ['x'] };
    expect(localStorage.getItem('cc.wholeTest')).not.toBeNull();
    s.value = {};
    expect(localStorage.getItem('cc.wholeTest')).toBeNull();
  });
});

describe('persistedSignal — diff mode (default, unchanged by whole-mode edit)', () => {
  it('still persists only keys that differ from the default', () => {
    const s = persistedSignal('diffTest', { a: 1, b: 2 });
    s.value = { a: 1, b: 9 };

    // Only the changed key is emitted; the default-valued key is omitted.
    expect(JSON.parse(localStorage.getItem('cc.diffTest') as string)).toEqual({ b: 9 });
  });

  it('ignores keys absent from the default (the exact behavior whole mode fixes)', () => {
    const s = persistedSignal<Record<string, number>>('diffTest', {});
    s.value = { runtimeKey: 1 };

    // Diff mode drops the runtime key -> no entry. This is why EXCLUDES needs
    // whole mode; asserting it here pins the boundary between the two modes.
    expect(localStorage.getItem('cc.diffTest')).toBeNull();
  });
});
