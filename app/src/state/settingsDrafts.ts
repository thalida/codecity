// state/settingsDrafts.ts — in-memory draft layer between the controls panel
// and the real signals. Widgets read getEffective() and write
// setDraft(); the Save button calls commit() to flush every draft into
// its signal (which triggers the existing persist + commit-reaction
// effects). Discard clears drafts without touching signals. Page
// reload drops drafts (in-memory only — the standard "unsaved changes"
// pattern).
//
// Storage shape: Map<storeRef, Map<key | null, value>>. For scalar-valued
// signals (no sub-key), key = null and the inner map has at most one entry.

import { signal } from '@preact/signals';
import { getDefault } from './persist';
import { forEachSettingStore } from './settingsSchema';
import { deepEqual, deepClone } from '@/utils/deep';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

type DraftKey = string | null;

const _drafts: Map<SignalLike, Map<DraftKey, unknown>> = new Map();

/**
 * Monotonic revision counter — bumped on every draft mutation
 * (set / stage / commit / discard). Preact components read this with
 * `DRAFTS_REV.value` to make `getEffective` lookups reactive: pair it
 * with a `store.value` read in the same render and the component
 * re-renders on either a draft change or an underlying signal change.
 */
export const DRAFTS_REV = signal(0);

function _emit(): void {
  // Bump the revision signal — components reading DRAFTS_REV.value re-render.
  DRAFTS_REV.value++;
}

function _committedValue(store: SignalLike, key: DraftKey): unknown {
  const state = store.value;
  if (key === null) return state;
  return state ? state[key] : undefined;
}

export function setDraft(store: SignalLike, key: DraftKey, value: unknown): void {
  const committed = _committedValue(store, key);
  let perStore = _drafts.get(store);
  if (deepEqual(value, committed)) {
    // Drop the entry — leaving "dirty" only when pending differs from committed.
    if (perStore && perStore.has(key)) {
      perStore.delete(key);
      if (perStore.size === 0) _drafts.delete(store);
      _emit();
    }
    return;
  }
  if (!perStore) {
    perStore = new Map();
    _drafts.set(store, perStore);
  }
  perStore.set(key, deepClone(value));
  _emit();
}

export function getEffective(store: SignalLike, key: DraftKey): unknown {
  const perStore = _drafts.get(store);
  if (perStore && perStore.has(key)) return perStore.get(key);
  return _committedValue(store, key);
}

export function stageReset(store: SignalLike, key: DraftKey): void {
  // For scalar signals: getDefault(store) returns the whole default value.
  // For object-valued signals: getDefault(store, key) returns the keyed default.
  const def = key === null ? getDefault(store) : getDefault(store, key);
  if (def === undefined) return;
  setDraft(store, key, def);
}

export function stageResetAll(): void {
  let touched = false;
  forEachSettingStore((store) => {
    const defaults = getDefault(store);
    // Direct-write signals (e.g. SYNTAX_THEME) bypass the draft layer on
    // user input — the widget writes straight to the signal for instant
    // visual feedback. Reset all must do the same, otherwise it leaves
    // a phantom draft that the user has to Save to clear.
    if ((store as { _skipDrafts?: boolean })._skipDrafts) {
      const s = store as SignalLike;
      if (!deepEqual(s.value, defaults)) {
        s.value = defaults;
      }
      return;
    }
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      // Object-valued signal: stage each sub-key whose effective value differs from default.
      for (const k in defaults) {
        if (!Object.hasOwn(defaults, k)) continue;
        if (deepEqual(getEffective(store as SignalLike, k), defaults[k])) continue;
        _stageWithoutEmit(store as SignalLike, k, defaults[k]);
        touched = true;
      }
    } else {
      // Scalar / array signal: stage whole default if effective differs.
      if (!deepEqual(getEffective(store as SignalLike, null), defaults)) {
        _stageWithoutEmit(store as SignalLike, null, defaults);
        touched = true;
      }
    }
  });
  if (touched) _emit();
}

/** True iff "Reset all" would change anything — i.e. any registered store has
 *  an effective (draft-aware) value differing from its default. Same iteration
 *  as stageResetAll, but read-only. Callers wanting reactivity should also read
 *  DRAFTS_REV.value + the committed signals (see ActionsBar). */
export function anyResettable(): boolean {
  let any = false;
  forEachSettingStore((store) => {
    const defaults = getDefault(store);
    if (any) return;
    if ((store as { _skipDrafts?: boolean })._skipDrafts) {
      if (!deepEqual((store as SignalLike).value, defaults)) any = true;
      return;
    }
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      for (const k in defaults) {
        if (!Object.hasOwn(defaults, k)) continue;
        if (
          !deepEqual(getEffective(store as SignalLike, k), (defaults as Record<string, unknown>)[k])
        ) {
          any = true;
          return;
        }
      }
    } else if (!deepEqual(getEffective(store as SignalLike, null), defaults)) {
      any = true;
    }
  });
  return any;
}

// Same write logic as setDraft but defers the _emit() call. Used by
// stageResetAll so a single fan-out happens after the whole sweep.
function _stageWithoutEmit(store: SignalLike, key: DraftKey, value: unknown): void {
  const committed = _committedValue(store, key);
  let perStore = _drafts.get(store);
  if (deepEqual(value, committed)) {
    if (perStore && perStore.has(key)) {
      perStore.delete(key);
      if (perStore.size === 0) _drafts.delete(store);
    }
    return;
  }
  if (!perStore) {
    perStore = new Map();
    _drafts.set(store, perStore);
  }
  perStore.set(key, deepClone(value));
}

export function commit(): void {
  if (_drafts.size === 0) {
    _emit();
    return;
  }
  // Snapshot the entries first; clearing _drafts before the writes makes
  // any synchronous signal effect that re-reads getEffective
  // see the freshly-committed value instead of the lingering draft.
  const entries: Array<[SignalLike, DraftKey, unknown]> = [];
  for (const [store, perStore] of _drafts) {
    for (const [key, value] of perStore) {
      entries.push([store, key, value]);
    }
  }
  _drafts.clear();
  for (const [store, key, value] of entries) {
    if (key === null) {
      store.value = value;
    } else {
      // Object-valued signal: merge the key in.
      store.value = { ...store.value, [key]: value };
    }
  }
  _emit();
}

export function discard(): void {
  if (_drafts.size === 0) {
    _emit();
    return;
  }
  _drafts.clear();
  _emit();
}

export function isDirty(): boolean {
  return _drafts.size > 0;
}

// Test-only hook so each test starts with an empty draft map.
export function _resetForTests(): void {
  _drafts.clear();
}
