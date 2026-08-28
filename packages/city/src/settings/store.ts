// settings/store.ts — one city's live settings, and who to tell when they
// change.
//
// A dispatch table, not a dependency graph. A consumer writes a value; the
// store works out which stores actually changed and calls the components that
// asked about those. That is the whole of it: no subscription is implicit, and
// nothing re-runs because it happened to read something.
//
// Reads are plain: `settings.BUILDINGS.HEIGHT_SCALE`. The object is a view over
// the current values, replaced wholesale on each update, so a caller holding a
// store's config object holds the values as they were — which is what the
// per-frame readers want.

import {
  CITY_FIELDS,
  defaultCitySettings,
  type CitySettings,
  type CitySettingsPatch,
  type CityStore,
} from './index';
import { coerceField, ChangeRoute } from './schema';

/** Called when one of the stores it was registered against changes. */
export type SettingsListener = () => void;

/** The values, plus the way to hear about them changing. Every city setting is
 *  readable straight off this: `settings.TREES.ENABLED`. */
export type CitySettingsStore = {
  readonly [K in CityStore]: CitySettings[K];
} & {
  /** Apply `listener` now, and again whenever any of `stores` changes. The
   *  immediate call is the point: a component's "put my settings on the
   *  material" is the same code at construction and on every Save, and having
   *  written it once it should not have to remember to run it. Returns the
   *  unsubscribe. */
  on(stores: CityStore | readonly CityStore[], listener: SettingsListener): () => void;
  /** Merge a patch in. Only the stores whose values actually differ are
   *  written, and only their listeners are called: a rebuild-routed store
   *  notifying on a no-op change repacks the whole city, which is seconds. */
  update(patch: CitySettingsPatch): void;
  /** Hear that a field on this route moved. NOT applied immediately, unlike
   *  `on`: that reports state a listener has to match, this reports a
   *  transition, and firing it at construction would claim a change that never
   *  happened. Returns the unsubscribe. */
  onRoute(route: ChangeRoute, listener: SettingsListener): () => void;
  /** Everything, as one plain object — for the worker request and for framing
   *  code that wants a value rather than a subscription. */
  snapshot(): CitySettings;
};

/** Drop what a field cannot use, so a bad value from a consumer falls back to
 *  stock rather than reaching the renderer. Same rules the app applies to a
 *  hydrated localStorage value; a store the city does not declare is ignored. */
function sanitize(patch: CitySettingsPatch): CitySettingsPatch {
  const out: Record<string, Record<string, unknown>> = {};
  for (const name in patch) {
    const fields = CITY_FIELDS[name as CityStore];
    if (!fields) continue;
    const incoming = patch[name as CityStore] as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const key in incoming) {
      const def = fields[key];
      if (!def) continue;
      const value = coerceField(incoming[key], def);
      if (value !== undefined) kept[key] = value;
    }
    if (Object.keys(kept).length) out[name] = kept;
  }
  return out as CitySettingsPatch;
}

// One level is enough: a store's value is a flat map of field values, and the
// non-scalar fields (TierWidths, HueMap) are replaced wholesale, never edited
// in place, so an identity check on them is the right test.
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const k in b) if (a[k] !== b[k]) return false;
  return true;
}

export function createSettingsStore(initial?: CitySettingsPatch): CitySettingsStore {
  let values = defaultCitySettings();
  const listeners = new Map<CityStore, Set<SettingsListener>>();
  const routeListeners = new Map<ChangeRoute, Set<SettingsListener>>();

  function update(patch: CitySettingsPatch): void {
    const clean = sanitize(patch);
    const changed: CityStore[] = [];
    // Per FIELD, not per store: a store carries fields on different routes, and
    // repacking the city because a colour moved is seconds of work for nothing.
    const routes = new Set<ChangeRoute>();
    const next = { ...values } as Record<string, unknown>;

    for (const name in clean) {
      const store = name as CityStore;
      const before = values[store] as Record<string, unknown>;
      const merged = { ...(before as object), ...clean[store] } as Record<string, unknown>;
      if (shallowEqual(before, merged)) continue;
      for (const key in clean[store] as object) {
        if (before[key] === merged[key]) continue;
        const def = CITY_FIELDS[store][key];
        if (def) routes.add(def.route);
      }
      next[store] = merged;
      changed.push(store);
    }
    if (changed.length === 0) return;

    // Swapped before anything is told, so a listener reading a sibling store
    // sees the whole update rather than half of it.
    values = next as CitySettings;

    // Over a copy of each set: a listener that unsubscribes itself would
    // otherwise mutate the set mid-iteration.
    const told = new Set<SettingsListener>();
    for (const store of changed) {
      for (const listener of [...(listeners.get(store) ?? [])]) {
        // A component registered against several stores hears once per update,
        // not once per store that moved.
        if (told.has(listener)) continue;
        told.add(listener);
        listener();
      }
    }

    // After the per-store listeners: a repack reads what they just applied.
    for (const route of routes) {
      for (const listener of [...(routeListeners.get(route) ?? [])]) listener();
    }
  }

  const store = {
    on(stores: CityStore | readonly CityStore[], listener: SettingsListener): () => void {
      const names = typeof stores === 'string' ? [stores] : stores;
      for (const name of names) {
        let set = listeners.get(name);
        if (!set) {
          set = new Set();
          listeners.set(name, set);
        }
        set.add(listener);
      }
      listener();
      return () => {
        for (const name of names) listeners.get(name)?.delete(listener);
      };
    },
    onRoute(route: ChangeRoute, listener: SettingsListener): () => void {
      let set = routeListeners.get(route);
      if (!set) {
        set = new Set();
        routeListeners.set(route, set);
      }
      set.add(listener);
      return () => void set.delete(listener);
    },
    update,
    snapshot: (): CitySettings => values,
  };

  // Getters rather than copied fields: `values` is replaced on every update,
  // and a component holding `settings` must see the current one.
  for (const name of Object.keys(CITY_FIELDS) as CityStore[]) {
    Object.defineProperty(store, name, {
      enumerable: true,
      get: () => values[name],
    });
  }

  if (initial) update(initial);
  return store as CitySettingsStore;
}
