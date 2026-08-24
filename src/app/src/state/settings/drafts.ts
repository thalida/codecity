// state/settings/drafts.ts — the in-memory layer between the controls panel and
// the real signals: what Save flushes and Discard throws away. See README.md.

import { signal } from '@preact/signals';
import { getDefault } from '@/state/persist';
import { forEachSettingStore, isAutosave, type SettingStore } from './schema';
import { deepEqual, deepClone } from '@/utils/deep';

type DraftKey = string | null;

const _drafts: Map<SettingStore, Map<DraftKey, unknown>> = new Map();

/** Bumped on every draft mutation, so a component pairing this with a
 *  `store.value` read re-renders on either. See README.md. */
export const DRAFTS_REV = signal(0);

function _emit(): void {
  // Bump the revision signal — components reading DRAFTS_REV.value re-render.
  DRAFTS_REV.value++;
}

function _committedValue(store: SettingStore, key: DraftKey): unknown {
  const state = store.value;
  if (key === null) return state;
  return state ? state[key] : undefined;
}

export function setDraft(store: SettingStore, key: DraftKey, value: unknown): void {
  if (isAutosave(store as object)) {
    // Write-through: apply immediately, never stage (Updates / Appearance tabs).
    store.value = key === null ? value : { ...store.value, [key]: value };
    _emit();
    return;
  }
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

export function getEffective(store: SettingStore, key: DraftKey): unknown {
  const perStore = _drafts.get(store);
  if (perStore && perStore.has(key)) return perStore.get(key);
  return _committedValue(store, key);
}

export function stageReset(store: SettingStore, key: DraftKey): void {
  // For scalar signals: getDefault(store) returns the whole default value.
  // For object-valued signals: getDefault(store, key) returns the keyed default.
  const def = key === null ? getDefault(store) : getDefault(store, key);
  if (def === undefined) return;
  setDraft(store, key, def);
}

export function stageResetAll(): void {
  let touched = false;
  forEachSettingStore((store) => {
    if (isAutosave(store as object)) return; // Reset-all is World-only
    const defaults = getDefault(store);
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      // Object-valued signal: stage each sub-key whose effective value differs from default.
      for (const k in defaults) {
        if (!Object.hasOwn(defaults, k)) continue;
        if (deepEqual(getEffective(store, k), defaults[k])) continue;
        _stageWithoutEmit(store, k, defaults[k]);
        touched = true;
      }
    } else {
      // Scalar / array signal: stage whole default if effective differs.
      if (!deepEqual(getEffective(store, null), defaults)) {
        _stageWithoutEmit(store, null, defaults);
        touched = true;
      }
    }
  });
  if (touched) _emit();
}

/** True iff "Reset all" would change anything. Read-only twin of stageResetAll;
 *  for reactivity read DRAFTS_REV.value and the committed signals too. */
export function anyResettable(): boolean {
  let any = false;
  forEachSettingStore((store) => {
    if (any) return;
    if (isAutosave(store as object)) return; // Reset-all is World-only
    const defaults = getDefault(store);
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      for (const k in defaults) {
        if (!Object.hasOwn(defaults, k)) continue;
        if (!deepEqual(getEffective(store, k), (defaults as Record<string, unknown>)[k])) {
          any = true;
          return;
        }
      }
    } else if (!deepEqual(getEffective(store, null), defaults)) {
      any = true;
    }
  });
  return any;
}

// Same write logic as setDraft but defers the _emit() call. Used by
// stageResetAll so a single fan-out happens after the whole sweep.
function _stageWithoutEmit(store: SettingStore, key: DraftKey, value: unknown): void {
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
  // Snapshot first: clearing before the writes makes a synchronous effect that
  // re-reads getEffective see the committed value, not the draft.
  const entries: Array<[SettingStore, DraftKey, unknown]> = [];
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

/** Forget staged edits for these stores. After a write straight to the signals
 *  (a settings import), a surviving draft would put the old value back. */
export function dropDrafts(stores: readonly SettingStore[]): void {
  let touched = false;
  for (const store of stores) {
    if (_drafts.delete(store)) touched = true;
  }
  if (touched) _emit();
}

// Test-only hook so each test starts with an empty draft map.
export function _resetForTests(): void {
  _drafts.clear();
}
