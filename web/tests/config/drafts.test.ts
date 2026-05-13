import { describe, it, expect, beforeEach } from 'vitest';
import { map, atom } from 'nanostores';
import {
  setDraft,
  getEffective,
  stageReset,
  stageResetAll,
  commit,
  discard,
  isDirty,
  subscribe,
  _resetForTests,
} from '@/config/drafts.js';
import { persistStore } from '@/config/persist.js';

interface FooConfig {
  COLOR: string;
  COUNT: number;
}

describe('drafts', () => {
  let FOO: ReturnType<typeof map<FooConfig>>;
  let BAR: ReturnType<typeof atom<number>>;

  beforeEach(() => {
    // Each test gets fresh stores + fresh draft state. Re-registering
    // the same name overwrites the prior registration (snapshot is
    // taken at persistStore time, before any setKey).
    localStorage.clear();
    _resetForTests();
    FOO = map<FooConfig>({ COLOR: '#000000', COUNT: 1 });
    BAR = atom<number>(10);
    persistStore('TEST_FOO', FOO);
    persistStore('TEST_BAR', BAR);
  });

  describe('setDraft + getEffective + isDirty', () => {
    it('returns committed value when no draft set', () => {
      expect(getEffective(FOO, 'COLOR')).toBe('#000000');
      expect(getEffective(BAR, null)).toBe(10);
    });

    it('returns pending value when draft set', () => {
      setDraft(FOO, 'COLOR', '#ff0000');
      expect(getEffective(FOO, 'COLOR')).toBe('#ff0000');
      expect(FOO.get().COLOR).toBe('#000000'); // store untouched
    });

    it('setDraft equal to committed value removes the draft', () => {
      setDraft(FOO, 'COLOR', '#ff0000');
      expect(isDirty()).toBe(true);
      setDraft(FOO, 'COLOR', '#000000');
      expect(isDirty()).toBe(false);
    });

    it('isDirty is false initially and after discard', () => {
      expect(isDirty()).toBe(false);
      setDraft(FOO, 'COUNT', 5);
      expect(isDirty()).toBe(true);
      discard();
      expect(isDirty()).toBe(false);
    });

    it('supports atom stores with key = null', () => {
      setDraft(BAR, null, 42);
      expect(getEffective(BAR, null)).toBe(42);
      expect(BAR.get()).toBe(10);
    });
  });

  describe('subscribe', () => {
    it('fires on setDraft, stageReset, stageResetAll, commit, discard', () => {
      let count = 0;
      const unsub = subscribe(() => { count++; });

      setDraft(FOO, 'COUNT', 5);
      expect(count).toBe(1);

      stageReset(FOO, 'COUNT');
      expect(count).toBe(2);

      setDraft(FOO, 'COUNT', 7);
      expect(count).toBe(3);

      commit();
      expect(count).toBe(4);

      setDraft(FOO, 'COUNT', 9);
      expect(count).toBe(5);

      discard();
      expect(count).toBe(6);

      unsub();
      setDraft(FOO, 'COUNT', 11);
      expect(count).toBe(6); // unsubscribed
    });
  });

  describe('stageReset', () => {
    it('stages the registered default into the draft', () => {
      FOO.setKey('COLOR', '#ff0000'); // committed override
      stageReset(FOO, 'COLOR');
      expect(getEffective(FOO, 'COLOR')).toBe('#000000');
      expect(FOO.get().COLOR).toBe('#ff0000'); // store untouched
      expect(isDirty()).toBe(true);
    });

    it('clears the draft entry when default equals committed', () => {
      // COLOR is currently at its default. setDraft to '#ff0000', then
      // stageReset puts the default back — and since default === committed,
      // the draft entry is dropped (not dirty).
      setDraft(FOO, 'COLOR', '#ff0000');
      stageReset(FOO, 'COLOR');
      expect(isDirty()).toBe(false);
    });

    it('works on atom stores', () => {
      BAR.set(99);
      stageReset(BAR, null);
      expect(getEffective(BAR, null)).toBe(10);
      expect(BAR.get()).toBe(99);
    });
  });

  describe('stageResetAll', () => {
    it('stages defaults for every registered (store, key) with non-default effective value', () => {
      FOO.setKey('COLOR', '#ff0000');
      FOO.setKey('COUNT', 99);
      BAR.set(42);
      stageResetAll();
      expect(getEffective(FOO, 'COLOR')).toBe('#000000');
      expect(getEffective(FOO, 'COUNT')).toBe(1);
      expect(getEffective(BAR, null)).toBe(10);
    });

    it('is a no-op on the second call (idempotent)', () => {
      FOO.setKey('COLOR', '#ff0000');
      stageResetAll();
      let count = 0;
      const unsub = subscribe(() => { count++; });
      stageResetAll();
      // No new draft entries to stage → no subscribers fired beyond
      // the always-fire end-of-call notification (allow ≤ 1).
      expect(count).toBeLessThanOrEqual(1);
      unsub();
    });

    it('skips entries where effective value already equals default', () => {
      // FOO is all default; only BAR is overridden.
      BAR.set(42);
      stageResetAll();
      // Only BAR should have been staged.
      // We can't directly read the draft map, but we know isDirty must
      // be true and getEffective(BAR) returns default.
      expect(isDirty()).toBe(true);
      expect(getEffective(BAR, null)).toBe(10);
      // Discard everything; nothing changes in committed stores.
      discard();
      expect(BAR.get()).toBe(42);
    });
  });

  describe('commit', () => {
    it('applies map-store drafts via setKey', () => {
      setDraft(FOO, 'COLOR', '#ff0000');
      setDraft(FOO, 'COUNT', 7);
      commit();
      expect(FOO.get()).toEqual({ COLOR: '#ff0000', COUNT: 7 });
      expect(isDirty()).toBe(false);
    });

    it('applies atom-store drafts via set', () => {
      setDraft(BAR, null, 42);
      commit();
      expect(BAR.get()).toBe(42);
      expect(isDirty()).toBe(false);
    });

    it('clears drafts after commit', () => {
      setDraft(FOO, 'COUNT', 5);
      commit();
      expect(getEffective(FOO, 'COUNT')).toBe(5); // now committed
      expect(isDirty()).toBe(false);
    });
  });

  describe('discard', () => {
    it('drops all pending drafts without touching stores', () => {
      setDraft(FOO, 'COLOR', '#ff0000');
      setDraft(BAR, null, 99);
      discard();
      expect(getEffective(FOO, 'COLOR')).toBe('#000000');
      expect(getEffective(BAR, null)).toBe(10);
      expect(FOO.get().COLOR).toBe('#000000');
      expect(BAR.get()).toBe(10);
      expect(isDirty()).toBe(false);
    });
  });
});
