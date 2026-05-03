// config/_persist.js — Mirrors every config store to localStorage so the
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

var STORAGE_PREFIX = 'cc.';

// Defaults snapshotted at attach time, BEFORE hydration. These are what the
// "reset to default" UI restores to and what the diff-vs-default check uses.
var _DEFAULTS_BY_NAME = {};
// Map from store reference → its registered name (so callers that already
// hold a store ref can ask "what's the default for this key?").
var _NAME_BY_STORE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

// Listeners notified after ANY config store changes its persisted state.
// The Reset-all button uses this to update its enabled/disabled state in
// real time as values are tweaked or reset.
var _changeListeners = [];

function _emitChange() {
  for (var i = 0; i < _changeListeners.length; i++) {
    try { _changeListeners[i](); } catch (_) { /* noop */ }
  }
}

function _safeGet(name) {
  try {
    var raw = localStorage.getItem(STORAGE_PREFIX + name);
    return raw == null ? null : JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function _safeSet(name, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
  } catch (_) {
    // Quota exceeded / private mode — silently drop. Live mutation still works.
  }
}

function _safeRemove(name) {
  try { localStorage.removeItem(STORAGE_PREFIX + name); }
  catch (_) { /* noop */ }
}

// Deep value-equality good enough for our config values: primitives, plain
// objects, arrays. JSON round-trip avoids hand-rolling a comparator and
// handles every shape we put in stores.
function _equal(a, b) {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch (_) { return false; }
}

function _clone(v) {
  try { return JSON.parse(JSON.stringify(v)); }
  catch (_) { return v; }
}

// Hydrate one store from localStorage if a value is persisted, then start
// streaming future changes back. Plain consts (no `subscribe`) are silently
// skipped so callers can sweep `import * as Config` blindly.
export function persistStore(name, store) {
  if (typeof localStorage === 'undefined') return;
  if (!store || typeof store.subscribe !== 'function') return;

  // Snapshot the original (pre-hydration) defaults. This is what reset
  // restores to and what the diff-vs-default check compares against.
  var defaults = _clone(store.get());
  _DEFAULTS_BY_NAME[name] = defaults;
  if (_NAME_BY_STORE) _NAME_BY_STORE.set(store, name);

  var saved = _safeGet(name);
  var initialState = store.get();
  var isMap = (typeof store.setKey === 'function')
    && initialState && typeof initialState === 'object'
    && !Array.isArray(initialState);

  if (isMap) {
    // map() — saved is a partial diff; restore each saved key.
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (var k in saved) {
        if (Object.prototype.hasOwnProperty.call(saved, k)) {
          store.setKey(k, saved[k]);
        }
      }
    }
    // On change, write the diff (only keys that differ from defaults).
    store.subscribe(function (state) {
      var diff = {};
      var any = false;
      for (var sk in state) {
        if (Object.prototype.hasOwnProperty.call(state, sk) &&
            !_equal(state[sk], defaults[sk])) {
          diff[sk] = state[sk];
          any = true;
        }
      }
      if (any) _safeSet(name, diff);
      else     _safeRemove(name);
      _emitChange();
    });
  } else {
    // atom() — single value. Saved replaces the whole thing.
    if (saved !== null) store.set(saved);
    store.subscribe(function (v) {
      if (_equal(v, defaults)) _safeRemove(name);
      else                     _safeSet(name, v);
      _emitChange();
    });
  }
}

// Bind every config store to localStorage. Call once at boot, BEFORE
// startRenderLoop so consumers see hydrated values during scene build.
export function attachPersistence(stores) {
  for (var name in stores) {
    if (Object.prototype.hasOwnProperty.call(stores, name)) {
      persistStore(name, stores[name]);
    }
  }
}

// getDefault(store, key) -> the originally-defined default for that key.
//   For map() stores: pass the key name. Returns the keyed default.
//   For atom() stores: omit `key`. Returns the whole default value.
// Returns undefined if the store wasn't registered via persistStore.
export function getDefault(store, key) {
  if (!_NAME_BY_STORE) return undefined;
  var name = _NAME_BY_STORE.get(store);
  if (!name) return undefined;
  var d = _DEFAULTS_BY_NAME[name];
  if (key === undefined) return d;
  return d ? d[key] : undefined;
}

// resetKey(store, key) — restore a single key (map) or the whole atom to
// its registered default. The store's subscribe handler installed above
// then removes the localStorage entry if no keys differ anymore.
export function resetKey(store, key) {
  var defaultVal = getDefault(store, key);
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
export function hasAnyOverrides() {
  if (typeof localStorage === 'undefined') return false;
  for (var name in _DEFAULTS_BY_NAME) {
    if (!Object.prototype.hasOwnProperty.call(_DEFAULTS_BY_NAME, name)) continue;
    try {
      if (localStorage.getItem(STORAGE_PREFIX + name) != null) return true;
    } catch (_) { /* ignore */ }
  }
  return false;
}

// onAnyChange(cb) — call cb() any time any registered config store's
// persisted state changes (including being reset back to default).
// Returns an unsubscribe function.
export function onAnyChange(cb) {
  if (typeof cb !== 'function') return function () {};
  _changeListeners.push(cb);
  return function () {
    var idx = _changeListeners.indexOf(cb);
    if (idx >= 0) _changeListeners.splice(idx, 1);
  };
}

// Wipe every persisted config slot — the panic "reset everything" path.
// Only touches stores we registered, so UI prefs (e.g. cc.sidebarWidth)
// survive a Reset-all.
export function clearPersistence() {
  if (typeof localStorage === 'undefined') return;
  for (var name in _DEFAULTS_BY_NAME) {
    if (Object.prototype.hasOwnProperty.call(_DEFAULTS_BY_NAME, name)) {
      _safeRemove(name);
    }
  }
}
