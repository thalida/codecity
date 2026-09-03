// A city's settings for a test: stock values, or stock with the fields the test
// actually cares about over the top. Nothing here touches the app's persisted
// stores — a city reads only what it is handed.

import {
  defaultCitySettings,
  mergeCitySettings,
  type CitySettings,
  type CitySettingsPatch,
} from '../../src/settings';
import { createSettingsStore, type CitySettingsStore } from '../../src/settings/store';
import { layoutConfigFrom, type LayoutConfig } from '../../src/layout/config';
import type { TreePlacementConfig } from '../../src/components/trees/treePlacement';

/** Stock settings, or stock with `over` merged in store by store. */
export function citySettings(over: CitySettingsPatch = {}): CitySettings {
  return mergeCitySettings(defaultCitySettings(), over);
}

/** A city's settings for a test: the values, and the way to change them. */
export function settingsStore(over: CitySettingsPatch = {}): CitySettingsStore {
  return createSettingsStore(over);
}

/** The packer's slice. */
export function layoutCfg(over: CitySettingsPatch = {}): LayoutConfig {
  return layoutConfigFrom(settingsStore(over));
}

/** What placeTrees reads. */
export function treeCfg(over: CitySettingsPatch = {}): TreePlacementConfig {
  const s = citySettings(over);
  return { TREES: s.TREES, FOOTPRINT: s.FOOTPRINT, WORLD: s.WORLD, ISLAND: s.ISLAND };
}
