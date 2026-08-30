// A persisted, panel-bindable signal for every store the city declares, and the
// value object each city instance on the page is handed.
//
// The city owns the list: CITY_FIELDS says which stores exist and what each

import { computed, type Signal } from '@preact/signals';
import {
  BACKDROP_CAMERA_FIELDS,
  CITY_FIELDS,
  type CityStore,
  type CitySettings,
} from '@codecity/city';

import { settingSignal } from '@/features/settings/state/schema';

/** Every city store, by the name the city gave it. Reached through the object
 *  rather than re-exported one by one: ESM cannot generate named exports, and a */
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

/** The landing's wallpaper is a second city, so it holds a second camera: the
 *  same fields the scene's declares, opening on the backdrop's values. */
export const HOME_BACKDROP = settingSignal('HOME_BACKDROP', BACKDROP_CAMERA_FIELDS);

/** The same settings with that camera over the top. Two cities on the page, two
 *  cameras: the package declares one camera vocabulary, and the app keeps a set */
export const BACKDROP_SETTINGS = computed<CitySettings>(() => ({
  ...CITY_SETTINGS.value,
  CAMERA: HOME_BACKDROP.value,
}));
