// settings/store.ts — one city's live settings. A signal per store, so the
// components' existing settings effects keep working while the values stop
// being global.
//
// The signals are an implementation detail and do not reach the public surface:
// a caller hands createCity a plain object and calls updateSettings(patch).
// Step 11 of #208 replaces them with an explicit re-apply dispatch, and every
// read site here loses its `.value` without moving.

import { signal, type Signal } from '@preact/signals';

import {
  CITY_FIELDS,
  defaultCitySettings,
  type CitySettings,
  type CitySettingsPatch,
  type CityStore,
} from './index';
import { coerceField } from './schema';

/** The reactive form of CitySettings: one signal per store. */
export type SettingSignals = { readonly [K in CityStore]: Signal<CitySettings[K]> };

export interface CitySettingsStore {
  /** What the components read: `settings.BUILDINGS.value.HEIGHT_SCALE`. */
  readonly signals: SettingSignals;
  /** Everything, as a plain object — for the worker request and for framing
   *  code that wants a value rather than a subscription. */
  snapshot(): CitySettings;
  /** Merge a patch in. Only the stores it names are written, so a component
   *  effect on an untouched store does not re-run. */
  update(patch: CitySettingsPatch): void;
}

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

export function createSettingsStore(initial?: CitySettingsPatch): CitySettingsStore {
  const base = defaultCitySettings();
  const signals = {} as Record<string, Signal<unknown>>;
  for (const name in base) {
    signals[name] = signal(base[name as CityStore]);
  }

  function update(patch: CitySettingsPatch): void {
    const clean = sanitize(patch);
    for (const name in clean) {
      const sig = signals[name];
      const next = { ...(sig.peek() as object), ...clean[name as CityStore] };
      // Skip an identical write: every component effect on this store would
      // re-run, and a rebuild-routed store would repack the whole city.
      if (shallowEqual(sig.peek() as Record<string, unknown>, next)) continue;
      sig.value = next;
    }
  }

  if (initial) update(initial);

  return {
    signals: signals as unknown as SettingSignals,
    snapshot(): CitySettings {
      const out = {} as Record<string, unknown>;
      for (const name in signals) out[name] = signals[name].peek();
      return out as CitySettings;
    },
    update,
  };
}

// One level is enough: a store's value is a flat map of field values, and the
// non-scalar fields (TierWidths, HueMap) are replaced wholesale, never edited
// in place, so an identity check on them is the right test.
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const k in b) if (a[k] !== b[k]) return false;
  return true;
}
