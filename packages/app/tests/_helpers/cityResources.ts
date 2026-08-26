import { createCityResources, type CityResources } from '@/city/resources';

/** A city's GPU resources without a WebGLRenderer. jsdom has no WebGL, and the
 *  renderer slot only ever feeds facade-panel uploads — with nothing registered
 *  those time out and resolve false, which is the path these tests want. */
export function createTestCityResources(): CityResources {
  return createCityResources(null);
}
