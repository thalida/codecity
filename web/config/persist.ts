// config/persist.ts — Mirrors every config store to localStorage so the
// Settings UI's tweaks survive a page reload. localStorage holds ONLY values
// that differ from the original defaults, so a fresh / cleared install starts
// with no entries at all and resetting a value back to its default removes
// the entry. This makes per-row reset icons trivial (just resetKey(...)) and
// keeps localStorage small.
//
// Storage layout: one localStorage key per store, prefixed with `cc.`:
//   cc.SIDEWALK_COLORS = '{"HOVER":"#ff0080"}'   ← only the changed key
//
// On boot, hydrates each store from its persisted overrides BEFORE any
// consumer reads. On every change, re-serializes the diff (or removes the
// entry entirely if no keys differ).
//
// Keep this module side-effect-free until `attachPersistence()` is called —
// tests + non-browser environments shouldn't touch localStorage.

import { STORAGE_PREFIX } from '../constants';

// Defaults snapshotted at attach time, BEFORE hydration. These are what the
// "reset to default" UI restores to and what the diff-vs-default check uses.
// `any` here is deliberate: each store has a different value shape and
// the diff/reset code is generic across all of them. Tightening to a
// `Record<string, MapStore | Atom>` would require carrying through generic
// parameters that don't actually buy us anything at the boundary.
const _DEFAULTS_BY_NAME: Record<string, any> = {};
// Map from store reference → its registered name (so callers that already
// hold a store ref can ask "what's the default for this key?").
const _NAME_BY_STORE: WeakMap<object, string> | null =
  typeof WeakMap !== 'undefined' ? new WeakMap() : null;
// Reverse lookup so Reset-all can push defaults back into every registered
// store without needing a separate registry from callers.
const _STORE_BY_NAME: Record<string, any> = {};

// Listeners notified after ANY config store changes its persisted state.
// The Reset-all button uses this to update its enabled/disabled state in
// real time as values are tweaked or reset.
const _changeListeners: Array<() => void> = [];

function _emitChange() {
  for (const listener of _changeListeners) {
    try {
      listener();
    } catch (_) {
      /* noop */
    }
  }
}

function _safeGet(name: string): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + name);
    return raw == null ? null : JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function _safeSet(name: string, value: unknown): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
  } catch (_) {
    // Quota exceeded / private mode — silently drop. Live mutation still works.
  }
}

function _safeRemove(name: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + name);
  } catch (_) {
    /* noop */
  }
}

// Deep value-equality good enough for our config values: primitives, plain
// objects, arrays. JSON round-trip avoids hand-rolling a comparator and
// handles every shape we put in stores.
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

// Hydrate one store from localStorage if a value is persisted, then start
// streaming future changes back. Plain consts (no `subscribe`) are silently
// skipped so callers can sweep `import * as Config` blindly.
export function persistStore(name: string, store: any): void {
  if (typeof localStorage === 'undefined') return;
  if (!store || typeof store.subscribe !== 'function') return;

  // Snapshot the original (pre-hydration) defaults. This is what reset
  // restores to and what the diff-vs-default check compares against.
  const defaults = _clone(store.get());
  _DEFAULTS_BY_NAME[name] = defaults;
  _STORE_BY_NAME[name] = store;
  if (_NAME_BY_STORE) _NAME_BY_STORE.set(store, name);

  const saved = _safeGet(name);
  const initialState = store.get();
  const isMap =
    typeof store.setKey === 'function' &&
    initialState &&
    typeof initialState === 'object' &&
    !Array.isArray(initialState);

  if (isMap) {
    // map() — saved is a partial diff; restore each saved key. Skip keys
    // that aren't in the current defaults (a previous version of the app
    // may have persisted a key that's since been removed; ignoring those
    // entries lets the schema evolve without piling stale data into the
    // live store).
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const k in saved) {
        if (!Object.hasOwn(saved, k)) continue;
        if (!Object.hasOwn(defaults, k)) continue;
        store.setKey(k, saved[k]);
      }
    }
    // On change, write the diff (only keys that exist in defaults AND
    // differ from them). Same skip-unknown-keys rule.
    store.subscribe((state) => {
      const diff = {};
      let any = false;
      for (const sk in state) {
        if (!Object.hasOwn(state, sk)) continue;
        if (!Object.hasOwn(defaults, sk)) continue;
        if (!_equal(state[sk], defaults[sk])) {
          diff[sk] = state[sk];
          any = true;
        }
      }
      if (any) _safeSet(name, diff);
      else _safeRemove(name);
      _emitChange();
    });
  } else {
    // atom() — single value. Saved replaces the whole thing.
    if (saved !== null) store.set(saved);
    store.subscribe((v) => {
      if (_equal(v, defaults)) _safeRemove(name);
      else _safeSet(name, v);
      _emitChange();
    });
  }
}

// Bind every config store to localStorage. Call once at boot, BEFORE
// startRenderLoop so consumers see hydrated values during scene build.
export function attachPersistence(stores: Record<string, any>): void {
  for (const name in stores) {
    if (Object.hasOwn(stores, name)) {
      persistStore(name, stores[name]);
    }
  }
}

// getDefault(store, key) -> the originally-defined default for that key.
//   For map() stores: pass the key name. Returns the keyed default.
//   For atom() stores: omit `key`. Returns the whole default value.
// Returns undefined if the store wasn't registered via persistStore.
export function getDefault(store: any, key?: string): any {
  if (!_NAME_BY_STORE) return undefined;
  const name = _NAME_BY_STORE.get(store);
  if (!name) return undefined;
  const d = _DEFAULTS_BY_NAME[name];
  if (key === undefined) return d;
  return d ? d[key] : undefined;
}

// resetKey(store, key) — restore a single key (map) or the whole atom to
// its registered default. The store's subscribe handler installed above
// then removes the localStorage entry if no keys differ anymore.
export function resetKey(store: any, key?: string): void {
  const defaultVal = getDefault(store, key);
  if (defaultVal === undefined) return;
  if (typeof store.setKey === 'function' && key !== undefined) {
    store.setKey(key, defaultVal);
  } else {
    store.set(defaultVal);
  }
}

// hasAnyOverrides() — true if at least one persisted config store has a
// non-default value. The Reset-all button uses this to decide whether it
// should be enabled. Scoped to the stores we actually registered, so
// unrelated cc.* keys (e.g. cc.sidebarWidth) don't influence it.
export function hasAnyOverrides(): boolean {
  if (typeof localStorage === 'undefined') return false;
  for (const name in _DEFAULTS_BY_NAME) {
    if (!Object.hasOwn(_DEFAULTS_BY_NAME, name)) continue;
    try {
      if (localStorage.getItem(STORAGE_PREFIX + name) != null) return true;
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

// onAnyChange(cb) — call cb() any time any registered config store's
// persisted state changes (including being reset back to default).
// Returns an unsubscribe function.
export function onAnyChange(cb: () => void): () => void {
  if (typeof cb !== 'function') return function () {};
  _changeListeners.push(cb);
  return function () {
    const idx = _changeListeners.indexOf(cb);
    if (idx >= 0) _changeListeners.splice(idx, 1);
  };
}

// Wipe every persisted config slot — the panic "reset everything" path.
// Only touches stores we registered, so UI prefs (e.g. cc.sidebarWidth)
// survive a Reset-all.
//
// Pushes defaults back into each store rather than just nuking localStorage:
// the store's subscribe handler then drops the localStorage entry on its own,
// AND consumers (live-poll loop, scene, controls UI) see the change live
// instead of waiting for a page reload.
export function clearPersistence(): void {
  for (const name in _DEFAULTS_BY_NAME) {
    if (!Object.hasOwn(_DEFAULTS_BY_NAME, name)) continue;
    const store = _STORE_BY_NAME[name];
    const defaults = _DEFAULTS_BY_NAME[name];
    if (!store) continue;
    if (
      typeof store.setKey === 'function' &&
      defaults &&
      typeof defaults === 'object' &&
      !Array.isArray(defaults)
    ) {
      for (const k in defaults) {
        if (Object.hasOwn(defaults, k)) {
          store.setKey(k, _clone(defaults[k]));
        }
      }
    } else {
      store.set(_clone(defaults));
    }
  }
}
