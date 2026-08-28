// The app holds a value for every store the city declares, and it derives that
// list rather than restating it. It used to be restated twice — one
// settingSignal line per store across thirteen files, and one `X: X.value` line
// per store in the object handed to a city — so adding a store to the city was
// three edits, and the two the app owned failed by doing nothing: no signal for
// the panel to bind to, and a city that never heard about the new store at all.

import { describe, it, expect } from 'vitest';
import { CITY_FIELDS, defaultCitySettings } from '@codecity/city';
import { CITY_STORES, CITY_SETTINGS, BACKDROP_SETTINGS } from '@/state/settings/values/city';
import { getFieldKeys } from '@/state/settings/schema';

const CITY_STORE_NAMES = Object.keys(CITY_FIELDS).sort();

describe('the app’s city stores', () => {
  it('has a signal for every store the city declares, and no others', () => {
    expect(Object.keys(CITY_STORES).sort()).toEqual(CITY_STORE_NAMES);
  });

  it('hands a city a value for every one of them', () => {
    expect(Object.keys(CITY_SETTINGS.value).sort()).toEqual(CITY_STORE_NAMES);
  });

  // Each signal has to be registered against the field map it was built from,
  // or the panel renders a store with no fields and Reset-all skips it.
  it('registers each store with the city’s own field list', () => {
    for (const [name, sig] of Object.entries(CITY_STORES)) {
      const declared = Object.keys(CITY_FIELDS[name as keyof typeof CITY_FIELDS]).sort();
      expect({ [name]: getFieldKeys(sig).sort() }).toEqual({ [name]: declared });
    }
  });

  it('opens on the same values the city would use with no consumer at all', () => {
    expect(CITY_SETTINGS.value).toEqual(defaultCitySettings());
  });

  // The landing's wallpaper is a second city: same vocabulary, its own camera.
  it('gives the backdrop every store, differing only in the camera', () => {
    expect(Object.keys(BACKDROP_SETTINGS.value).sort()).toEqual(CITY_STORE_NAMES);
    const { CAMERA: _sceneCamera, ...scene } = CITY_SETTINGS.value;
    const { CAMERA: _backdropCamera, ...backdrop } = BACKDROP_SETTINGS.value;
    expect(backdrop).toEqual(scene);
  });
});
