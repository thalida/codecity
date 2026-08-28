import { createCityResources, type CityResources } from '@/city/resources';
import type { CitySettingsStore } from '@/city/settings/store';
import { settingsStore } from './citySettings';

/** A city's GPU resources without a WebGLRenderer. jsdom has no WebGL, and the
 *  renderer slot only ever feeds facade-panel uploads — with nothing registered
 *  those time out and resolve false, which is the path these tests want. */
export function createTestCityResources(
  settings: CitySettingsStore = settingsStore()
): CityResources {
  return createCityResources(null, settings);
}
