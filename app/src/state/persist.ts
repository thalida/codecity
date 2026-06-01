// state/persist.ts — Signals-native persistence layer.
//
// Storage layout: one localStorage key per signal, prefixed with `cc.`:
//   cc.SKY = '{"COLOR":"#ff0080"}'   ← object diff (only changed keys)
//   cc.LIVE_UPDATES = '{"ENABLED":true}'
//
// Object-valued signals persist only keys that differ from their default
// (diff-vs-default), so a fresh install starts with no entries and resetting
// a value back to its default removes the entry.

import { signal, effect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { STORAGE_PREFIX } from '@/constants';
import { deepEqual, deepClone } from '@/utils/deep';

// ── Registry ───────────────────────────────────────────────────────────────
// One map keyed by the store signal itself; each entry holds the persisted
// key name (localStorage suffix) and the pre-hydration default. Keying by the
// signal (not the name) makes getDefault / HAS_ANY_NON_DEFAULT /
// forEachRegisteredStore direct lookups — no reverse name↔signal scan.
interface StoreEntry { name: string; default: any; }
const _STORES: Map<Signal<any>, StoreEntry> = new Map();

// ── Storage helpers ────────────────────────────────────────────────────────
function _safeGet(key: string): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw == null ? null : JSON.parse(raw);
  } catch { return null; }
}

function _safeSet(key: string, value: unknown): void {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

function _safeRemove(key: string): void {
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* noop */ }
}

// Hydrate a plain value from localStorage onto `defaultValue`.
// Object-valued: merge saved diff keys (skip unknown keys — schema evolution).
// Scalar/array: replace whole value.
function _hydrate<T>(saved: unknown, defaultValue: T): T {
  if (
    defaultValue !== null &&
    typeof defaultValue === 'object' &&
    !Array.isArray(defaultValue) &&
    saved !== null &&
    typeof saved === 'object' &&
    !Array.isArray(saved)
  ) {
    const merged: Record<string, unknown> = { ...(defaultValue as Record<string, unknown>) };
    for (const k in saved as object) {
      if (!Object.hasOwn(saved as object, k)) continue;
      if (!Object.hasOwn(defaultValue as object, k)) continue; // skip removed keys
      merged[k] = (saved as Record<string, unknown>)[k];
    }
    return merged as T;
  }
  return saved as T;
}

// Serialize: for object-valued signals emit only keys that differ from default.
// For scalar/array signals emit the whole value.
function _serialize<T>(value: T, defaultValue: T): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    defaultValue !== null &&
    typeof defaultValue === 'object' &&
    !Array.isArray(defaultValue)
  ) {
    const diff: Record<string, unknown> = {};
    let any = false;
    for (const k in value as object) {
      if (!Object.hasOwn(value as object, k)) continue;
      if (!Object.hasOwn(defaultValue as object, k)) continue;
      if (!deepEqual((value as Record<string, unknown>)[k], (defaultValue as Record<string, unknown>)[k])) {
        diff[k] = (value as Record<string, unknown>)[k];
        any = true;
      }
    }
    return any ? diff : null; // null signals "remove entry"
  }
  return deepEqual(value, defaultValue) ? null : value;
}

// ── Public: per-signal persistence ────────────────────────────────────────

/**
 * Create a signal whose value is persisted in localStorage. Hydrates from
 * storage immediately at module load. Writes back on every change (diff-vs-
 * default for object-valued signals; whole value for scalar/array).
 *
 * The `key` string is the localStorage suffix after `cc.` — keep it stable
 * across deploys so existing users don't lose their settings.
 */
export function persistedSignal<T>(key: string, defaultValue: T): Signal<T> {
  if (typeof localStorage === 'undefined') {
    // SSR / test environment without localStorage — return a plain signal.
    const s = signal<T>(defaultValue);
    _STORES.set(s, { name: key, default: deepClone(defaultValue) });
    return s;
  }
  const saved = _safeGet(key);
  const initial = saved !== null ? _hydrate(saved, defaultValue) : defaultValue;
  const s = signal<T>(initial);
  _STORES.set(s, { name: key, default: deepClone(defaultValue) });

  effect(() => {
    const v = s.value;
    const serialized = _serialize(v, defaultValue);
    if (serialized === null) _safeRemove(key);
    else _safeSet(key, serialized);
  });

  return s;
}

// ── Public: getDefault ───────────────────────────────────────────────────────
// Loose signal-like type used at the boundary with settingsDrafts.ts / the controls
// layer, which have their own local SignalLike interface. These are always
// real @preact/signals Signal instances at runtime.
type AnySignalLike = { value: any };

/** Return the pre-hydration default for a signal, or a keyed sub-default. Works
 *  for any persisted store (this is the one cross-cutting concern persist owns;
 *  "which stores are settings" lives in state/schema). */
export function getDefault(store: AnySignalLike, key?: string): any {
  const entry = _STORES.get(store as Signal<any>);
  if (!entry) return undefined;
  return key === undefined ? entry.default : (entry.default ? entry.default[key] : undefined);
}
