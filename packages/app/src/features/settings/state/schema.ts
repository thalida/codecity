// features/settings/state/schema.ts — the machinery that turns a field declaration into
// a live, persisted signal. What a field IS lives in @codecity/city; this is
// where the app gives it a value. See README.md.

import {
  type ChangeRoute,
  coerceField,
  type ConfigOf,
  type FieldDef,
  type FieldMap,
} from '@codecity/city';
import { computed, type Signal } from '@preact/signals';

import { persistedSignal, getDefault } from '@/lib/persist';
import { deepEqual } from '@/lib/deep';

// Straight through from the city, not via the local bindings: prefresh reads
// exports before resolving imports and fails on a name it cannot see yet.
export {
  ChangeRoute,
  FieldKind,
  type SelectOption,
  type FieldDef,
  type FieldMap,
  type ConfigOf,
} from '@codecity/city';

// store signal → its field map. A Map, not WeakMap, so it is iterable; the
// stores are module-level singletons and are never collected.
const _FIELDS = new Map<object, FieldMap>();

// Deliberately narrower than persist's registry, so Reset-all never touches
// recents or sidebar width. See README.md.
const _SETTING_STORES = new Set<object>();

/** Register a store as panel-owned, and return its unregister. settingSignal
 *  does this automatically; a plain persistedSignal calls it explicitly. */
export function markSettingStore(store: object): () => void {
  _SETTING_STORES.add(store);
  return () => unregisterSettingStore(store);
}

/** Drop a store and forget its fields: a short-lived one left registered
 *  leaks into anyResettable() and HAS_ANY_NON_DEFAULT forever. */
export function unregisterSettingStore(store: object): void {
  _SETTING_STORES.delete(store);
  _FIELDS.delete(store);
}

/** A settings store as the machinery around it reads and writes one. Always a
 *  @preact/signals Signal at runtime; this is the narrow surface used here. */
export interface SettingStore {
  value: any;
}

/** Visit every settings store (settingSignal + hand-registered). The settings
 *  draft/reset machinery uses this instead of persist.forEachRegisteredStore. */
export function forEachSettingStore(cb: (store: SettingStore) => void): void {
  for (const s of _SETTING_STORES) cb(s as SettingStore);
}

const _AUTOSAVE_STORES = new WeakSet<object>();

/** Write-through: widgets apply on change instead of staging drafts. The
 *  autosave tabs (Updates, Appearance) are cheap and want instant feedback. */
export function markAutosave(store: object): void {
  _AUTOSAVE_STORES.add(store);
}

export function isAutosave(store: object): boolean {
  return _AUTOSAVE_STORES.has(store);
}

/** True when any store holds a committed non-default value, autosave included.
 *  Read purely as a reactivity signal; Reset-all keys off anyResettable(). */
export const HAS_ANY_NON_DEFAULT = computed(() => {
  for (const s of _SETTING_STORES) {
    const store = s as { value: unknown };
    if (!deepEqual(store.value, getDefault(store))) return true;
  }
  return false;
});

// Clamp a number to a field's [min, max] (no-op when a bound is absent).

// One value against its definition: the usable form of it (clamped where the
// field has bounds), or undefined when it is not that kind of value at all.

// One hydrated value against its definition, falling back to the default.
// Guards stale or tampered localStorage; the cases are in README.md.
function sanitizeField(value: unknown, def: FieldDef): unknown {
  const coerced = coerceField(value, def);
  return coerced === undefined ? def.default : coerced;
}

/** An outside value (an imported file) against a field: its usable form, or
 *  undefined so the caller can report the miss instead of quietly defaulting. */
export function coerceFieldValue(store: object, key: string, value: unknown): unknown | undefined {
  const def = _FIELDS.get(store)?.[key];
  return def === undefined ? undefined : coerceField(value, def);
}

/** A persisted settings store from a flat field map: defaults, validation and
 *  panel registration all derived from it. See README.md. */
export function settingSignal<F extends FieldMap>(key: string, fields: F): Signal<ConfigOf<F>> {
  const def = {} as ConfigOf<F>;
  for (const k in fields) {
    (def as Record<string, unknown>)[k] = fields[k].default;
  }
  const sig = persistedSignal<ConfigOf<F>>(key, def);

  // Re-persist only when something was actually off, so a stale entry cannot
  // feed an invalid value into the scene.
  const current = sig.peek() as Record<string, unknown>;
  const cleaned: Record<string, unknown> = { ...current };
  let changed = false;
  for (const k in fields) {
    const sane = sanitizeField(current[k], fields[k]);
    if (!deepEqual(sane, current[k])) {
      cleaned[k] = sane;
      changed = true;
    }
  }
  if (changed) sig.value = cleaned as ConfigOf<F>;

  _FIELDS.set(sig, fields);
  _SETTING_STORES.add(sig);
  return sig;
}

/** Look up a field definition by (store, key). Returns undefined if the store
 *  wasn't created via settingSignal or the key isn't a defined field. */
export function getFieldDef(store: object, key: string): FieldDef | undefined {
  return _FIELDS.get(store)?.[key];
}

/** All defined field keys for a store (for completeness checks/tests). */
export function getFieldKeys(store: object): string[] {
  const map = _FIELDS.get(store);
  return map ? Object.keys(map) : [];
}

/** A string that changes iff a field with this route changes, so the wrapping
 *  computed notifies for one route only. Call inside a computed(). */
export function routeSignature(route: ChangeRoute): string {
  let sig = '';
  for (const [store, fields] of _FIELDS) {
    const v = (store as SettingStore).value as Record<string, unknown>;
    for (const key in fields) {
      if (fields[key].route === route) {
        sig += `${key}=${JSON.stringify(v[key])};`;
      }
    }
  }
  return sig;
}
