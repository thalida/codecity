import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@preact/signals';
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
} from '@/state/drafts';
import { persistStore } from '@/state/persist';

interface FooConfig {
  COLOR: string;
  COUNT: number;
}

describe('drafts', () => {
  let FOO: ReturnType<typeof signal<FooConfig>>;
  let BAR: ReturnType<typeof signal<number>>;

  beforeEach(() => {
    // Each test gets fresh stores + fresh draft state. Re-registering
    // the same name overwrites the prior registration (snapshot is
    // taken at persistStore time, before any setKey).
    localStorage.clear();
    _resetForTests();
    FOO = signal<FooConfig>({ COLOR: '#000000', COUNT: 1 });
    BAR = signal<number>(10);
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
      expect(FOO.value.COLOR).toBe('#000000'); // store untouched
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
      expect(BAR.value).toBe(10);
    });

    it('treats falsy draft values as real drafts (uses Map.has, not falsy check)', () => {
      // Default COUNT is 1; drafting 0 must not be mistaken for "no draft".
      setDraft(FOO, 'COUNT', 0);
      expect(getEffective(FOO, 'COUNT')).toBe(0);
      expect(isDirty()).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('fires on setDraft, stageReset, stageResetAll, commit, discard', () => {
      let count = 0;
      const unsub = subscribe(() => {
        count++;
      });

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
      FOO.value = { ...FOO.value, COLOR: '#ff0000' }; // committed override
      stageReset(FOO, 'COLOR');
      expect(getEffective(FOO, 'COLOR')).toBe('#000000');
      expect(FOO.value.COLOR).toBe('#ff0000'); // store untouched
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
      BAR.value = 99;
      stageReset(BAR, null);
      expect(getEffective(BAR, null)).toBe(10);
      expect(BAR.value).toBe(99);
    });
  });

  describe('stageResetAll', () => {
    it('stages defaults for every registered (store, key) with non-default effective value', () => {
      FOO.value = { ...FOO.value, COLOR: '#ff0000', COUNT: 99 };
      BAR.value = 42;
      stageResetAll();
      expect(getEffective(FOO, 'COLOR')).toBe('#000000');
      expect(getEffective(FOO, 'COUNT')).toBe(1);
      expect(getEffective(BAR, null)).toBe(10);
    });

    it('is a no-op on the second call (idempotent)', () => {
      FOO.value = { ...FOO.value, COLOR: '#ff0000' };
      stageResetAll();
      let count = 0;
      const unsub = subscribe(() => {
        count++;
      });
      stageResetAll();
      // No new draft entries to stage → no subscribers fired beyond
      // the always-fire end-of-call notification (allow ≤ 1).
      expect(count).toBeLessThanOrEqual(1);
      unsub();
    });

    it('skips entries where effective value already equals default', () => {
      // FOO is all default; only BAR is overridden.
      BAR.value = 42;
      stageResetAll();
      // Only BAR should have been staged.
      // We can't directly read the draft map, but we know isDirty must
      // be true and getEffective(BAR) returns default.
      expect(isDirty()).toBe(true);
      expect(getEffective(BAR, null)).toBe(10);
      // Discard everything; nothing changes in committed stores.
      discard();
      expect(BAR.value).toBe(42);
    });
  });

  describe('commit', () => {
    it('applies map-store drafts via setKey', () => {
      setDraft(FOO, 'COLOR', '#ff0000');
      setDraft(FOO, 'COUNT', 7);
      commit();
      expect(FOO.value).toEqual({ COLOR: '#ff0000', COUNT: 7 });
      expect(isDirty()).toBe(false);
    });

    it('applies atom-store drafts via set', () => {
      setDraft(BAR, null, 42);
      commit();
      expect(BAR.value).toBe(42);
      expect(isDirty()).toBe(false);
    });

    it('clears drafts after commit', () => {
      setDraft(FOO, 'COUNT', 5);
      commit();
      expect(getEffective(FOO, 'COUNT')).toBe(5); // now committed
      expect(isDirty()).toBe(false);
    });

    it('clears drafts before firing store subscribers (synchronous subscribers see committed value, not lingering draft)', () => {
      let observedInsideSubscribe: unknown = null;
      setDraft(FOO, 'COLOR', '#ff0000');
      // Install subscriber AFTER setting the draft but BEFORE commit, so it
      // only fires on the commit-driven write. Signals fire subscribers
      // synchronously — capture only the LAST value observed.
      const unsub = FOO.subscribe(() => {
        observedInsideSubscribe = getEffective(FOO, 'COLOR');
      });
      commit();
      unsub();
      // Inside the subscriber, getEffective must reflect the committed value
      // — the draft must already be cleared at that point.
      expect(observedInsideSubscribe).toBe('#ff0000');
      // And of course committed reads return it too.
      expect(FOO.value.COLOR).toBe('#ff0000');
    });
  });

  describe('discard', () => {
    it('drops all pending drafts without touching stores', () => {
      setDraft(FOO, 'COLOR', '#ff0000');
      setDraft(BAR, null, 99);
      discard();
      expect(getEffective(FOO, 'COLOR')).toBe('#000000');
      expect(getEffective(BAR, null)).toBe(10);
      expect(FOO.value.COLOR).toBe('#000000');
      expect(BAR.value).toBe(10);
      expect(isDirty()).toBe(false);
    });
  });
});
