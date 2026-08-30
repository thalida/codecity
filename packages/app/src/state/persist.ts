// state/persist.ts — signals-native persistence: one localStorage key per
// signal, under `cc.`. An object-valued signal stores only the keys that differ
// from its default, so a fresh install holds no entries at all and a value put
// back to its default takes its own entry with it.

import { signal, effect, type Signal } from '@preact/signals';
import { STORAGE_PREFIX } from '@/constants/storage';
import { deepEqual, deepClone } from '@/state/deep';

// ── Registry ───────────────────────────────────────────────────────────────

// Keyed by the signal, not its name, so a lookup needs no reverse scan. EVERY
// persisted store; the panel-owned subset lives in settings/schema.ts.
interface StoreEntry {
  name: string;
  default: any;
  /** Stored entire rather than diffed. Required for a Record whose keys are
   *  runtime values, which diff mode (default-keys only) would drop. */
  whole: boolean;
}
const _STORES: Map<Signal<any>, StoreEntry> = new Map();

// ── Storage helpers ────────────────────────────────────────────────────────
function _safeGet(key: string): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function _safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function _safeRemove(key: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    /* noop */
  }
}

// Hydrate onto `defaultValue`: an object merges the saved diff keys and skips
// ones the default no longer has, anything else replaces whole.
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
      if (
        !deepEqual(
          (value as Record<string, unknown>)[k],
          (defaultValue as Record<string, unknown>)[k]
        )
      ) {
        diff[k] = (value as Record<string, unknown>)[k];
        any = true;
      }
    }
    return any ? diff : null; // null signals "remove entry"
  }
  return deepEqual(value, defaultValue) ? null : value;
}

// One store's persisted form: whole-object stores skip the diff entirely, since
// their keys are runtime values the default never holds.
function _serializeEntry(value: unknown, entry: StoreEntry): unknown {
  if (entry.whole) return deepEqual(value, entry.default) ? null : value;
  return _serialize(value, entry.default);
}

// ── Public: per-signal persistence ────────────────────────────────────────

/** A signal persisted under `cc.<key>`, hydrated at module load. `key` is that
 *  suffix: keep it stable across deploys or existing users lose the setting. */
export function persistedSignal<T>(
  key: string,
  defaultValue: T,
  opts?: { whole?: boolean }
): Signal<T> {
  if (typeof localStorage === 'undefined') {
    // SSR / test environment without localStorage — return a plain signal.
    const s = signal<T>(defaultValue);
    _STORES.set(s, { name: key, default: deepClone(defaultValue), whole: opts?.whole === true });
    return s;
  }
  const saved = _safeGet(key);
  const initial =
    saved !== null ? (opts?.whole ? (saved as T) : _hydrate(saved, defaultValue)) : defaultValue;
  const s = signal<T>(initial);
  _STORES.set(s, { name: key, default: deepClone(defaultValue), whole: opts?.whole === true });

  effect(() => {
    const serialized = _serializeEntry(s.value, _STORES.get(s)!);
    if (serialized === null) _safeRemove(key);
    else _safeSet(key, serialized);
  });

  return s;
}

// ── Public: reading a store back ─────────────────────────────────────────────

// The narrow surface the settings layer meets these through. Always a real
// @preact/signals Signal at runtime.
type AnySignalLike = { value: any };

/** The pre-hydration default for a signal, or one of its keyed sub-defaults.
 *  Works for any persisted store, settings or not. */
export function getDefault(store: AnySignalLike, key?: string): any {
  const entry = _STORES.get(store as Signal<any>);
  if (!entry) return undefined;
  return key === undefined ? entry.default : entry.default ? entry.default[key] : undefined;
}

/** The store's localStorage suffix — its stable identity across builds, and so
 *  the name a settings file refers to it by. Undefined if unregistered. */
export function getStoreName(store: AnySignalLike): string | undefined {
  return _STORES.get(store as Signal<any>)?.name;
}
