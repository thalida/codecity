// state/drafts.ts — in-memory draft layer between the controls panel
// and the real nanostores. Widgets read getEffective() and write
// setDraft(); the Save button calls commit() to flush every draft into
// its store (which triggers the existing persist + commit-reaction
// subscriptions). Discard clears drafts without touching stores. Page
// reload drops drafts (in-memory only — the standard "unsaved changes"
// pattern).
//
// Storage shape: Map<storeRef, Map<key | null, value>>. For atom stores
// (no setKey), key = null and the inner map has at most one entry.

import { forEachRegisteredStore, getDefault } from './persist.js';

interface MapLikeStore {
  get(): any;
  set?(value: any): void;
  setKey?(key: string, value: any): void;
  subscribe(listener: (state: any) => void): () => void;
}

type DraftKey = string | null;

const _drafts: Map<MapLikeStore, Map<DraftKey, unknown>> = new Map();
const _listeners: Array<() => void> = [];

function _emit(): void {
  for (const cb of _listeners) {
    try {
      cb();
    } catch (_) {
      /* noop */
    }
  }
}

function _equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
}

function _clone<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch (_) {
    return v;
  }
}

function _committedValue(store: MapLikeStore, key: DraftKey): unknown {
  const state = store.get();
  if (key === null) return state;
  return state ? state[key] : undefined;
}

export function setDraft(store: MapLikeStore, key: DraftKey, value: unknown): void {
  const committed = _committedValue(store, key);
  let perStore = _drafts.get(store);
  if (_equal(value, committed)) {
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
  perStore.set(key, _clone(value));
  _emit();
}

export function getEffective(store: MapLikeStore, key: DraftKey): unknown {
  const perStore = _drafts.get(store);
  if (perStore && perStore.has(key)) return perStore.get(key);
  return _committedValue(store, key);
}

export function stageReset(store: MapLikeStore, key: DraftKey): void {
  // For atom stores: getDefault(store) returns the whole default value.
  // For map stores: getDefault(store, key) returns the keyed default.
  const def = key === null ? getDefault(store) : getDefault(store, key);
  if (def === undefined) return;
  setDraft(store, key, def);
}

export function stageResetAll(): void {
  let touched = false;
  forEachRegisteredStore((_name, store, defaults) => {
    // Direct-write stores (e.g. SYNTAX_THEME) bypass the draft layer on
    // user input — the widget writes straight to the atom for instant
    // visual feedback. Reset all must do the same, otherwise it leaves
    // a phantom draft that the user has to Save to clear.
    if ((store as { _skipDrafts?: boolean })._skipDrafts) {
      const s = store as MapLikeStore;
      if (!_equal(s.get(), defaults) && typeof s.set === 'function') {
        s.set(defaults);
      }
      return;
    }
    if (
      defaults &&
      typeof defaults === 'object' &&
      !Array.isArray(defaults) &&
      typeof (store as MapLikeStore).setKey === 'function'
    ) {
      // Map store: stage each sub-key whose effective value differs from default.
      for (const k in defaults) {
        if (!Object.hasOwn(defaults, k)) continue;
        if (_equal(getEffective(store as MapLikeStore, k), defaults[k])) continue;
        _stageWithoutEmit(store as MapLikeStore, k, defaults[k]);
        touched = true;
      }
    } else {
      // Atom store (or array-shaped atom): stage whole default if effective differs.
      if (!_equal(getEffective(store as MapLikeStore, null), defaults)) {
        _stageWithoutEmit(store as MapLikeStore, null, defaults);
        touched = true;
      }
    }
  });
  if (touched) _emit();
}

// Same write logic as setDraft but defers the _emit() call. Used by
// stageResetAll so a single fan-out happens after the whole sweep.
function _stageWithoutEmit(store: MapLikeStore, key: DraftKey, value: unknown): void {
  const committed = _committedValue(store, key);
  let perStore = _drafts.get(store);
  if (_equal(value, committed)) {
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
  perStore.set(key, _clone(value));
}

export function commit(): void {
  if (_drafts.size === 0) {
    _emit();
    return;
  }
  // Snapshot the entries first; clearing _drafts before the writes makes
  // any synchronous store.subscribe handler that re-reads getEffective
  // see the freshly-committed value instead of the lingering draft.
  const entries: Array<[MapLikeStore, DraftKey, unknown]> = [];
  for (const [store, perStore] of _drafts) {
    for (const [key, value] of perStore) {
      entries.push([store, key, value]);
    }
  }
  _drafts.clear();
  for (const [store, key, value] of entries) {
    if (key === null) {
      if (typeof store.set === 'function') store.set(value);
    } else {
      if (typeof store.setKey === 'function') store.setKey(key, value);
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

export function subscribe(cb: () => void): () => void {
  if (typeof cb !== 'function') return function () {};
  _listeners.push(cb);
  return function () {
    const idx = _listeners.indexOf(cb);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

// Test-only hook so each test starts with an empty draft map.
export function _resetForTests(): void {
  _drafts.clear();
  _listeners.length = 0;
}
