// state/settings/cityValues.ts — the app's twenty city stores as one value, in
// the shape @codecity/city takes. The panel binds to the individual signals;
// a city instance is handed the whole object and diffs it itself.

import type { CitySettings } from '@codecity/city';
import { computed } from '@preact/signals';

import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/settings/fields/buildings';
import { CAMERA } from '@/state/settings/fields/camera';
import { BLOOM, RAINBOW } from '@/state/settings/fields/effects';
import { FIREFLIES } from '@/state/settings/fields/fireflies';
import { FOOTPRINT } from '@/state/settings/fields/footprint';
import { GEM, GEM_SIZING, REPO_LABEL } from '@/state/settings/fields/gem';
import { HOME_BACKDROP } from '@/state/settings/fields/homeBackdrop';
import { ISLAND, WORLD } from '@/state/settings/fields/island';
import { RUINS } from '@/state/settings/fields/ruins';
import { SCENE } from '@/state/settings/fields/scene';
import { SCRUBBER } from '@/state/settings/fields/scrubber';
import { STREETS, STREET_LAYOUT, STREET_TIERS } from '@/state/settings/fields/streets';
import { TREES } from '@/state/settings/fields/trees';

/** Every city setting the app holds a value for. Recomputes on any one of them,
 *  which is fine: updateSettings writes only the stores that actually differ. */
export const CITY_SETTINGS = computed<CitySettings>(() => ({
  BLOOM: BLOOM.value,
  BUILDING_DIMENSIONS: BUILDING_DIMENSIONS.value,
  BUILDINGS: BUILDINGS.value,
  CAMERA: CAMERA.value,
  FIREFLIES: FIREFLIES.value,
  FOOTPRINT: FOOTPRINT.value,
  GEM: GEM.value,
  GEM_SIZING: GEM_SIZING.value,
  ISLAND: ISLAND.value,
  RAINBOW: RAINBOW.value,
  REPO_LABEL: REPO_LABEL.value,
  RUINS: RUINS.value,
  SCENE: SCENE.value,
  SCRUBBER: SCRUBBER.value,
  STREETS: STREETS.value,
  STREET_LAYOUT: STREET_LAYOUT.value,
  STREET_TIERS: STREET_TIERS.value,
  TREES: TREES.value,
  WORLD: WORLD.value,
}));

/** The same settings with the landing wallpaper's own camera over the top. Two
 *  cities on the page, two cameras: the package declares one camera vocabulary,
 *  and the app keeps a set of values per city it mounts. */
export const BACKDROP_SETTINGS = computed<CitySettings>(() => ({
  ...CITY_SETTINGS.value,
  CAMERA: HOME_BACKDROP.value,
}));
