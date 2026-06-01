// state/settingsSchema.ts — Schema-driven settings core.
//
// A setting store is a FLAT map of field definitions: each key carries what
// the field intrinsically *is* (kind, default, label, tip, bounds/options) —
// independent of where it's shown. settingSignal() derives the persisted
// default object from those `default`s and hands it to the existing
// persistedSignal (unchanged persistence/drafts), and registers the field map
// so the controls panel can look a field up by (store, key).
//
// The persisted *type* is derived from the same map via ConfigOf<> — the
// schema is the single source for both the defaults and the config type; no
// separate default object, no hand-written interface to drift.
//
// Arrangement (which section/subgroup a field sits in, nesting, order) is NOT
// here — that lives in the controls UI layer (views/ControlsPane/partials).

import { computed, type Signal } from '@preact/signals';
import { persistedSignal, getDefault } from '@/state/persist';
import { deepEqual } from '@/utils/deep';

/** A Select field's choices. Defined here (not imported from the view's
 *  SegmentedSelect) so state/ stays view-independent — the option array a
 *  store declares is structurally identical to what the widget renders. */
export interface SelectOption {
  value: string;
  label: string;
}

export enum FieldKind {
  Slider = 'slider',
  Number = 'number',
  Color = 'color',
  Toggle = 'toggle',
  Select = 'select',
  RangePair = 'rangePair',
  /** An ordered array of { min_descendants, width } street tiers — one width
   *  slider per tier. The field's value is the whole array (see STREET_TIERS). */
  TierWidths = 'tierWidths',
  /** A { key: hue } map — one 0–359° hue slider per key, with a swatch preview.
   *  The field's value is the whole object (see BUILDINGS.HUE_EXT_MAP). */
  HueMap = 'hueMap',
}

/** What changing a field requires the scene to do. Drives settingsReactions.ts's
 *  rebuild/material-refresh signatures (auto-generated from this metadata):
 *   Refresh — applyTheme only (material/uniform update). The default.
 *   Rebuild — full world applyManifest (structural/geometry/layout change).
 *   Live    — neither; read fresh per frame (e.g. gem/firefly animation) or
 *             driven elsewhere (e.g. live-update polling). */
export enum ChangeRoute {
  Refresh = 'refresh',
  Rebuild = 'rebuild',
  Live = 'live',
}

/** One field's intrinsic definition. `default`'s type flows through to the
 *  store's config type (see ConfigOf). min/max/step apply to numeric kinds;
 *  options to Select. `route` is REQUIRED — every field states what changing it
 *  triggers, so the store file is legible at a glance and settingsReactions.ts can
 *  generate its rebuild/refresh signatures from it. */
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

// store signal → its field map, for (store, key) lookups from the panel and
// for reactions' route-driven signatures. A Map (not WeakMap) so it's
// iterable; the stores are module-level singletons, never GC'd.
const _FIELDS = new Map<object, FieldMap>();

// The set of stores the SETTINGS panel owns — every settingSignal store, plus a
// few hand-registered ones (e.g. SYNTAX_THEME, a direct-write setting). This is
// deliberately NARROWER than persist's all-persisted registry: the panel's
// "Reset all" / draft / non-default machinery iterates ONLY these, so
// non-settings persisted state (recents, sidebar width/collapsed) is never
// reset or counted by the settings UI.
const _SETTING_STORES = new Set<object>();

/** Register a store as panel-owned settings (so Reset-all / draft staging act
 *  on it). settingSignal calls this automatically; direct-write settings that
 *  don't use settingSignal (e.g. SYNTAX_THEME) call it explicitly. */
export function markSettingStore(store: object): void {
  _SETTING_STORES.add(store);
}

/** Visit every settings store (settingSignal + hand-registered). The settings
 *  draft/reset machinery uses this instead of persist.forEachRegisteredStore. */
export function forEachSettingStore(cb: (store: { value: unknown }) => void): void {
  for (const s of _SETTING_STORES) cb(s as { value: unknown });
}

/** True when ANY settings store holds a (committed) non-default value — drives
 *  the Reset-all button's enabled state. Scoped to settings stores only. */
export const HAS_ANY_NON_DEFAULT = computed(() => {
  for (const s of _SETTING_STORES) {
    const store = s as { value: unknown };
    if (!deepEqual(store.value, getDefault(store))) return true;
  }
  return false;
});

/**
 * Create a persisted settings store from a flat field map. Derives the default
 * object from each field's `default`, wraps persistedSignal (so persistence,
 * hydration, diff-vs-default, drafts and getDefault all behave exactly as
 * before), and registers the field map for panel lookups.
 *
 * The returned signal's value type is ConfigOf<F> — inferred from the map, so
 * `STORE.value.KEY` is typed and a `satisfies`/ConfigOf alias gives the config
 * type with nothing stated twice.
 */
export function settingSignal<F extends FieldMap>(key: string, fields: F): Signal<ConfigOf<F>> {
  const def = {} as ConfigOf<F>;
  for (const k in fields) {
    (def as Record<string, unknown>)[k] = fields[k].default;
  }
  const sig = persistedSignal<ConfigOf<F>>(key, def);
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

/**
 * Build a change-signature string over every registered settingSignal field
 * whose `route` matches (default Refresh). The returned string changes iff a
 * routed field's value changes — so a computed wrapping this notifies (and the
 * reaction fires) ONLY for the relevant route, with no cross-firing.
 *
 * Reads each matching field's `store.value[key]`, which subscribes the calling
 * computed to that store. Call inside reactions' computed().
 */
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
