// state/settings/schema.ts — how a setting is DECLARED, and the machinery that
// turns a declaration into a live signal. A field says what it IS; where it is
// SHOWN belongs to the controls layer. See README.md.

import { computed, type Signal } from '@preact/signals';
import { persistedSignal, getDefault } from '@/state/persist';
import { deepEqual } from '@/utils/deep';

/** A Select field's choices, declared here rather than imported from the view
 *  so state/ stays view-independent. Structurally what the widget renders. */
export interface SelectOption {
  value: string;
  label: string;
}

export enum FieldKind {
  SliderField = 'slider',
  Number = 'number',
  Color = 'color',
  ToggleField = 'toggle',
  Select = 'select',
  RangePairField = 'rangePair',
  /** An ordered array of { min_descendants, width } street tiers — one width
   *  slider per tier. The field's value is the whole array (see STREET_TIERS). */
  TierWidths = 'tierWidths',
  /** A { key: hue } map — one 0–359° hue slider per key, with a swatch preview.
   *  The field's value is the whole object (see BUILDINGS.HUE_EXT_MAP). */
  HueMap = 'hueMap',
}

/** What changing a field requires of the scene. reactions.ts generates its
 *  signatures from this, so nothing keeps a per-store key list. See README.md. */
export enum ChangeRoute {
  Refresh = 'refresh',
  Rebuild = 'rebuild',
  Live = 'live',
}

/** One field's intrinsic definition; `default`'s type flows through to the
 *  store's config type. `route` is required, and reactions.ts reads it. */
export interface FieldDef<T = unknown> {
  kind: FieldKind;
  route: ChangeRoute;
  default: T;
  label: string;
  tip?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: SelectOption[];
}

/** A store's fields: a flat key → FieldDef map. */
export type FieldMap = Record<string, FieldDef>;

/** Derive the persisted config object type from a field map:
 *  { KEY: typeof KEY.default }. */
export type ConfigOf<F extends FieldMap> = { [K in keyof F]: F[K]['default'] };

// store signal → its field map. A Map, not WeakMap, so it is iterable; the
// stores are module-level singletons and are never collected.
const _FIELDS = new Map<object, FieldMap>();

// Deliberately narrower than persist's registry, so Reset-all never touches
// recents or sidebar width. See README.md.
const _SETTING_STORES = new Set<object>();

/** Register a store as panel-owned. settingSignal does this automatically; a
 *  plain persistedSignal (SYNTAX_THEME) calls it explicitly. */
export function markSettingStore(store: object): void {
  _SETTING_STORES.add(store);
}

/** Test-only. A disposable per-test store must unregister before the next one
 *  is made, or it leaks into anyResettable()/HAS_ANY_NON_DEFAULT forever. */
export function _unregisterForTests(store: object): void {
  _SETTING_STORES.delete(store);
  _FIELDS.delete(store);
}

/** Visit every settings store (settingSignal + hand-registered). The settings
 *  draft/reset machinery uses this instead of persist.forEachRegisteredStore. */
export function forEachSettingStore(cb: (store: { value: unknown }) => void): void {
  for (const s of _SETTING_STORES) cb(s as { value: unknown });
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
function clampToBounds(n: number, def: FieldDef): number {
  if (def.min != null && n < def.min) return def.min;
  if (def.max != null && n > def.max) return def.max;
  return n;
}

// One hydrated value against its definition, falling back to the default.
// Guards stale or tampered localStorage; the cases are in README.md.
function sanitizeField(value: unknown, def: FieldDef): unknown {
  const fallback = def.default;
  switch (def.kind) {
    case FieldKind.SliderField:
    case FieldKind.Number:
      return typeof value === 'number' && Number.isFinite(value)
        ? clampToBounds(value, def)
        : fallback;
    case FieldKind.RangePairField:
      return Array.isArray(value) &&
        value.length === 2 &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n))
        ? [clampToBounds(value[0] as number, def), clampToBounds(value[1] as number, def)]
        : fallback;
    case FieldKind.ToggleField:
      return typeof value === 'boolean' ? value : fallback;
    case FieldKind.Select:
      return def.options?.some((o) => o.value === value) ? value : fallback;
    default:
      return typeof value === typeof fallback && Array.isArray(value) === Array.isArray(fallback)
        ? value
        : fallback;
  }
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

interface ValueStore {
  value: Record<string, unknown>;
}

/** A string that changes iff a field with this route changes, so the wrapping
 *  computed notifies for one route only. Call inside a computed(). */
export function routeSignature(route: ChangeRoute): string {
  let sig = '';
  for (const [store, fields] of _FIELDS) {
    const v = (store as ValueStore).value;
    for (const key in fields) {
      if (fields[key].route === route) {
        sig += `${key}=${JSON.stringify(v[key])};`;
      }
    }
  }
  return sig;
}
