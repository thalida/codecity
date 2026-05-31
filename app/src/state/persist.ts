// state/persist.ts — Signals-native persistence layer.
//
// Storage layout: one localStorage key per signal, prefixed with `cc.`:
//   cc.SKY = '{"COLOR":"#ff0080"}'   ← object diff (only changed keys)
//   cc.LIVE_UPDATES = '{"ENABLED":true}'
//
// Object-valued signals persist only keys that differ from their default
// (diff-vs-default), so a fresh install starts with no entries and resetting
// a value back to its default removes the entry.
//
// Per-source slots: cc.source.<key>.<baseName> — see perSourceSignal().
// Save/load are explicit on source switch; no auto-slot-swap effects.

import { signal, computed, effect } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { STORAGE_PREFIX, STORAGE_PER_SOURCE_PREFIX } from '@/constants';

// ── Internal registries ────────────────────────────────────────────────────
const _SIGNALS: Map<string, Signal<any>> = new Map();
const _DEFAULTS: Map<string, any> = new Map();

// Per-source registry: { baseName, signal, defaultValue }
interface PerSourceEntry<T> { baseName: string; signal: Signal<T>; defaultValue: T }
const _PER_SOURCE: Set<PerSourceEntry<any>> = new Set();

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

// Deep-equality via JSON round-trip — handles every shape we put in signals.
function _equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function _clone<T>(v: T): T {
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
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
      if (!_equal((value as Record<string, unknown>)[k], (defaultValue as Record<string, unknown>)[k])) {
        diff[k] = (value as Record<string, unknown>)[k];
        any = true;
      }
    }
    return any ? diff : null; // null signals "remove entry"
  }
  return _equal(value, defaultValue) ? null : value;
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
    _DEFAULTS.set(key, defaultValue);
    _SIGNALS.set(key, s);
    return s;
  }
  const saved = _safeGet(key);
  const initial = saved !== null ? _hydrate(saved, defaultValue) : defaultValue;
  const s = signal<T>(initial);
  _DEFAULTS.set(key, _clone(defaultValue));
  _SIGNALS.set(key, s);

  effect(() => {
    const v = s.value;
    const serialized = _serialize(v, defaultValue);
    if (serialized === null) _safeRemove(key);
    else _safeSet(key, serialized);
  });

  return s;
}

/**
 * `persistStore(key, store)` — registers a pre-existing signal with the
 * persistence layer. Hydrates from storage and sets up the write effect.
 * Used by tests (drafts.test.ts) and by code that can't call persistedSignal
 * at definition time (e.g. PICKER_SELECTION_KEY which is perSourceSignal).
 *
 * This is intentionally kept as an escape hatch; new code should use
 * persistedSignal() at definition time instead.
 */
export function persistStore(key: string, store: Signal<any>): void {
  if (!store || typeof store !== 'object' || !('value' in store)) return;
  const defaultValue = _clone(store.value);
  _DEFAULTS.set(key, defaultValue);
  _SIGNALS.set(key, store);

  if (typeof localStorage === 'undefined') return;
  const saved = _safeGet(key);
  if (saved !== null) store.value = _hydrate(saved, defaultValue);

  effect(() => {
    const v = store.value;
    const serialized = _serialize(v, defaultValue);
    if (serialized === null) _safeRemove(key);
    else _safeSet(key, serialized);
  });
}

// ── Public: per-source persistence ────────────────────────────────────────

function _perSourceKey(sourceKey: string, baseName: string): string {
  return `${STORAGE_PER_SOURCE_PREFIX}${sourceKey}.${baseName}`;
}

function _hydrateOne<T>(s: Signal<T>, baseName: string, defaultValue: T, sourceKey: string | null): void {
  if (sourceKey === null || typeof localStorage === 'undefined') {
    s.value = defaultValue;
    return;
  }
  const raw = localStorage.getItem(_perSourceKey(sourceKey, baseName));
  if (raw !== null) {
    try { s.value = JSON.parse(raw) as T; }
    catch { s.value = defaultValue; }
  } else {
    s.value = defaultValue;
  }
}

/**
 * Create a signal whose value is scoped to the current source key. The initial
 * value is the defaultValue (no hydration at call time — hydration happens via
 * loadPerSourceState after CURRENT_SOURCE_KEY is set). Callers must call
 * savePerSourceState(oldKey) BEFORE switching sources and loadPerSourceState(newKey)
 * AFTER setting the new source key.
 */
export function perSourceSignal<T>(baseName: string, defaultValue: T): Signal<T> {
  const s = signal<T>(defaultValue);
  const entry: PerSourceEntry<T> = { baseName, signal: s, defaultValue };
  _PER_SOURCE.add(entry as PerSourceEntry<any>);
  return s;
}

/** Persist ALL per-source signals' current values under `sourceKey`.
 *  Call BEFORE changing CURRENT_SOURCE_KEY. No-op when sourceKey is null. */
export function savePerSourceState(sourceKey: string | null): void {
  if (sourceKey === null || typeof localStorage === 'undefined') return;
  for (const entry of _PER_SOURCE) {
    try {
      localStorage.setItem(
        _perSourceKey(sourceKey, entry.baseName),
        JSON.stringify(entry.signal.value)
      );
    } catch { /* quota / private mode */ }
  }
}

/** Hydrate ALL per-source signals from `sourceKey`.
 *  Call AFTER setting the new CURRENT_SOURCE_KEY. */
export function loadPerSourceState(sourceKey: string | null): void {
  for (const entry of _PER_SOURCE) {
    _hydrateOne(entry.signal, entry.baseName, entry.defaultValue, sourceKey);
  }
}

// ── Public: derived state ──────────────────────────────────────────────────

/** True when ANY registered persistedSignal holds a non-default value.
 *  Replaces the old _changeListeners + onAnyChange + hasAnyOverrides() pattern.
 *  The Reset-all button reads HAS_ANY_NON_DEFAULT.value for its enabled state. */
export const HAS_ANY_NON_DEFAULT = computed(() => {
  for (const [key, s] of _SIGNALS) {
    const def = _DEFAULTS.get(key);
    if (!_equal(s.value, def)) return true;
  }
  return false;
});

// ── Public: getDefault / forEachRegisteredStore ─

// Loose signal-like type used at the boundary with drafts.ts / controlsPane
// which have their own local interface types (SignalLike, MapLikeStore).
// These are always real @preact/signals Signal instances at runtime.
type AnySignalLike = { value: any };

/** Return the pre-hydration default for a signal, or a keyed sub-default. */
export function getDefault(store: AnySignalLike, key?: string): any {
  for (const [k, s] of _SIGNALS) {
    if ((s as unknown) === store) {
      const def = _DEFAULTS.get(k);
      return key === undefined ? def : (def ? def[key] : undefined);
    }
  }
  return undefined;
}

/** Visit every registered signal. Used by drafts.ts for stageResetAll. */
export function forEachRegisteredStore(
  cb: (name: string, store: AnySignalLike, defaults: any) => void
): void {
  for (const [key, s] of _SIGNALS) {
    const def = _DEFAULTS.get(key);
    cb(key, s as AnySignalLike, def);
  }
}
