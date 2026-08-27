import type * as THREE from 'three';

import { createBuildingMaterial, type BuildingMaterial } from './components/buildings/material';
import {
  createRendererRegistry,
  type RendererRegistry,
} from './components/buildings/facadePanelTextureArray';
import { createGemTextures, type GemTextures } from './components/gem/mesh';
import type { SettingSignals } from './settings/store';

/** Everything one city owns that used to be a module-level `let`.
 *
 *  These are not policy problems, they are GPU resource corruption: a
 *  ShaderMaterial belongs to the context that compiled it, an icon atlas to the
 *  build that produced it, and the renderer slot had room for exactly one
 *  renderer. Two cities on one page sharing any of them is a bug that stays
 *  invisible only while they live on different routes.
 *
 *  Deliberately NOT in here: `registerShaderChunks`'s latch (`THREE.ShaderChunk`
 *  really is global), the WebGL2 max-array-layers probe (a property of the
 *  device, not of a city), the `authorColor` and `treeEncoding` memo caches
 *  (content-keyed, so sharing is correct), the media-load limiter (shared on
 *  purpose — see mediaLoadLimiter.ts), the layout profiler (off by default,
 *  dev-console only, and normally lives in the per-city worker), and every
 *  scratch vector and matrix (single-threaded, never retained across frames).
 */
export interface CityResources {
  /** The building ShaderMaterial and the icon atlas bound to its uniforms. */
  readonly buildings: BuildingMaterial;
  readonly gem: GemTextures;
  /** Where facade-panel uploads find this city's renderer. */
  readonly renderer: RendererRegistry;
  /** True once the capture harness has kicked off its timeline pass. */
  timelineKickedOff: boolean;
  dispose(): void;
}

export function createCityResources(
  renderer: THREE.WebGLRenderer | null,
  settings: SettingSignals
): CityResources {
  const buildings = createBuildingMaterial(settings);
  const gem = createGemTextures();
  const rendererRegistry = createRendererRegistry();
  // Null only in tests: jsdom has no WebGL, and an unregistered slot makes
  // facade uploads time out and resolve false rather than hang.
  if (renderer) rendererRegistry.register(renderer);

  return {
    buildings,
    gem,
    renderer: rendererRegistry,
    timelineKickedOff: false,
    dispose(): void {
      buildings.dispose();
      gem.dispose();
    },
  };
}
