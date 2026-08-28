// state/settings/cityStores.ts — a persisted, panel-bindable signal for every
// store the city declares, and the one value object a city instance is handed.
//
// The city owns the list: CITY_FIELDS says which stores exist and what each
// one's knobs are, so this derives from it rather than restating it. It used to
// be restated twice — one `settingSignal(...)` line per store across thirteen
// files, and one `X: X.value` line per store below them — and a store added to
// the city was three edits, of which two failed silently by doing nothing.

import { computed, type Signal } from '@preact/signals';
import { CITY_FIELDS, type CityStore, type CitySettings } from '@codecity/city';

import { settingSignal } from '@/state/settings/schema';
import { HOME_BACKDROP } from '@/state/settings/fields/homeBackdrop';

/** Every city store, by the name the city gave it. Reached through the object
 *  rather than re-exported one by one: ESM cannot generate named exports, and a
 *  hand-written export list is the same restatement in a shorter coat. */
export const CITY_STORES = Object.fromEntries(
  Object.entries(CITY_FIELDS).map(([store, fields]) => [store, settingSignal(store, fields)])
) as { [K in CityStore]: Signal<CitySettings[K]> };

/** Every city setting the app holds a value for. Recomputes on any one of them,
 *  which is fine: updateSettings writes only the stores that actually differ. */
export const CITY_SETTINGS = computed<CitySettings>(
  () =>
    Object.fromEntries(
      Object.entries(CITY_STORES).map(([store, sig]) => [store, sig.value])
    ) as CitySettings
);

/** The same settings with the landing wallpaper's own camera over the top. Two
 *  cities on the page, two cameras: the package declares one camera vocabulary,
 *  and the app keeps a set of values per city it mounts. */
export const BACKDROP_SETTINGS = computed<CitySettings>(() => ({
  ...CITY_SETTINGS.value,
  CAMERA: HOME_BACKDROP.value,
}));
