// city/layout/config.ts — the settings slice the packer reads. Named as a
// subset of CitySettings rather than a shape of its own, so the worker request
// carries the city's own values across unchanged and nothing translates keys
// on either side.

import { defaultCitySettings, type CitySettings } from '../settings';
import type { CitySettingsStore } from '../settings/store';

/** The four stores layoutCity and dimensions.ts read. Everything else the
 *  city is tunable about is main-thread only and never reaches the packer. */
export type LayoutConfig = Pick<
  CitySettings,
  'STREET_LAYOUT' | 'BUILDING_DIMENSIONS' | 'GEM_SIZING' | 'STREET_TIERS'
>;

/** The packer's slice of a live city's settings, read untracked: the packer is
 *  called from an apply, not from a subscription. */
export function layoutConfigFrom(settings: CitySettingsStore): LayoutConfig {
  return {
    STREET_LAYOUT: settings.STREET_LAYOUT,
    BUILDING_DIMENSIONS: settings.BUILDING_DIMENSIONS,
    GEM_SIZING: settings.GEM_SIZING,
    STREET_TIERS: settings.STREET_TIERS,
  };
}
