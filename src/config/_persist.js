// config/_persist.js — Mirrors every config store to localStorage so the
// Settings UI's tweaks survive a page reload. On boot, hydrates each store
// from the persisted JSON before any consumer reads it. On every change,
// re-serializes that store's slot.
//
// Storage layout: one localStorage key per store, prefixed with `cc.`:
//   cc.SIDEWALK_COLORS = '{"DEFAULT":"#abc","HOVER":"#def",...}'
//
// Keep this module side-effect-free until `attachPersistence()` is called —
// tests + non-browser environments shouldn't touch localStorage.

const STORAGE_PREFIX = 'cc.';

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

// Hydrate one store from localStorage if a value is persisted, then start
// streaming future changes back. Works for both `map()` (object value) and
// `atom()` (any value — primitive, array, or object).
export function persistStore(name, store) {
  if (typeof localStorage === 'undefined') return;
  var saved = _safeGet(name);
  if (saved !== null) {
    if (typeof store.setKey === 'function' && saved && typeof saved === 'object' && !Array.isArray(saved)) {
      // map() — restore each key so we don't drop unsaved keys added since
      for (var k in saved) {
        if (Object.prototype.hasOwnProperty.call(saved, k)) {
          store.setKey(k, saved[k]);
        }
      }
    } else {
      store.set(saved);
    }
  }
  store.subscribe(function (v) { _safeSet(name, v); });
}

// Wipe every persisted slot — useful for "reset to defaults" in the UI.
export function clearPersistence() {
  if (typeof localStorage === 'undefined') return;
  var toDelete = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.indexOf(STORAGE_PREFIX) === 0) toDelete.push(k);
  }
  for (var j = 0; j < toDelete.length; j++) {
    try { localStorage.removeItem(toDelete[j]); } catch (_) { /* noop */ }
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
