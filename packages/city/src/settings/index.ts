// settings/index.ts — every store the city has, named once. A field map says
// what a store's knobs ARE (settings/fields/); this says which stores exist,
// and derives the config type and the stock values from them. Nothing here
// holds a value: `CitySettings` is a plain object a caller passes in.

import { defaultsOf, type ConfigOf, type FieldMap } from './schema';
import { BUILDING_DIMENSIONS_FIELDS, BUILDINGS_FIELDS } from './fields/buildings';
import { CAMERA_FIELDS } from './fields/camera';
import { RAINBOW_FIELDS, BLOOM_FIELDS } from './fields/effects';
import { FIREFLIES_FIELDS } from './fields/fireflies';
import { FOOTPRINT_FIELDS } from './fields/footprint';
import { GEM_FIELDS, GEM_SIZING_FIELDS, REPO_LABEL_FIELDS } from './fields/gem';
import { ISLAND_FIELDS, WORLD_FIELDS } from './fields/island';
import { RUINS_FIELDS } from './fields/ruins';
import { SCENE_FIELDS } from './fields/scene';
import { SCRUBBER_FIELDS } from './fields/scrubber';
import { STREETS_FIELDS, STREET_TIERS_FIELDS, STREET_LAYOUT_FIELDS } from './fields/streets';
import { TREES_FIELDS } from './fields/trees';

/** Store name → its field map. The city's whole tunable surface; a consumer
 *  renders a settings UI off this without knowing any store by name. */
export const CITY_FIELDS = {
  BLOOM: BLOOM_FIELDS,
  BUILDING_DIMENSIONS: BUILDING_DIMENSIONS_FIELDS,
  BUILDINGS: BUILDINGS_FIELDS,
  CAMERA: CAMERA_FIELDS,
  FIREFLIES: FIREFLIES_FIELDS,
  FOOTPRINT: FOOTPRINT_FIELDS,
  GEM: GEM_FIELDS,
  GEM_SIZING: GEM_SIZING_FIELDS,
  ISLAND: ISLAND_FIELDS,
  RAINBOW: RAINBOW_FIELDS,
  REPO_LABEL: REPO_LABEL_FIELDS,
  RUINS: RUINS_FIELDS,
  SCENE: SCENE_FIELDS,
  SCRUBBER: SCRUBBER_FIELDS,
  STREETS: STREETS_FIELDS,
  STREET_LAYOUT: STREET_LAYOUT_FIELDS,
  STREET_TIERS: STREET_TIERS_FIELDS,
  TREES: TREES_FIELDS,
  WORLD: WORLD_FIELDS,
} satisfies Record<string, FieldMap>;

export type CityStore = keyof typeof CITY_FIELDS;

/** Every setting the city reads, resolved. What createCity is handed and what
 *  its internals read; no signals, no persistence, no store objects. */
export type CitySettings = {
  [K in CityStore]: ConfigOf<(typeof CITY_FIELDS)[K]>;
};

/** A partial update: some stores, and within each, some keys. */
export type CitySettingsPatch = {
  [K in CityStore]?: Partial<CitySettings[K]>;
};

/** Stock values, straight off the declarations. A fresh object each call, so a
 *  caller can edit it without reaching every other city on the page. */
export function defaultCitySettings(): CitySettings {
  const out = {} as Record<string, unknown>;
  for (const k in CITY_FIELDS) {
    out[k] = defaultsOf(CITY_FIELDS[k as CityStore]);
  }
  return out as CitySettings;
}

/** Base with a patch over the top, store by store. Neither input is mutated. */
export function mergeCitySettings(base: CitySettings, patch: CitySettingsPatch): CitySettings {
  const out = { ...base } as Record<string, unknown>;
  for (const k in patch) {
    const store = patch[k as CityStore];
    if (store) out[k] = { ...(base[k as CityStore] as object), ...store };
  }
  return out as CitySettings;
}
