// A city's settings for a test: stock values, or stock with the fields the test
// actually cares about over the top. Nothing here touches the app's persisted
// stores — a city reads only what it is handed.

import {
  defaultCitySettings,
  mergeCitySettings,
  type CitySettings,
  type CitySettingsPatch,
} from '@/city/settings';
import {
  createSettingsStore,
  type CitySettingsStore,
  type SettingSignals,
} from '@/city/settings/store';
import { layoutConfigOf, type LayoutConfig } from '@/city/layout/config';
import type { TreePlacementConfig } from '@/city/components/trees/treePlacement';

/** Stock settings, or stock with `over` merged in store by store. */
export function citySettings(over: CitySettingsPatch = {}): CitySettings {
  return mergeCitySettings(defaultCitySettings(), over);
}

/** A live store, for a test that changes a setting and asserts what happened. */
export function settingsStore(over: CitySettingsPatch = {}): CitySettingsStore {
  return createSettingsStore(over);
}

/** The reactive form, for a component or factory that takes SettingSignals. */
export function settingSignals(over: CitySettingsPatch = {}): SettingSignals {
  return createSettingsStore(over).signals;
}

/** The packer's slice. */
export function layoutCfg(over: CitySettingsPatch = {}): LayoutConfig {
  return layoutConfigOf(citySettings(over));
}

/** What placeTrees reads. */
export function treeCfg(over: CitySettingsPatch = {}): TreePlacementConfig {
  const s = citySettings(over);
  return { TREES: s.TREES, FOOTPRINT: s.FOOTPRINT, WORLD: s.WORLD, ISLAND: s.ISLAND };
}
