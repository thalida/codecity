// city/components/island/islandShader.ts — ShaderMaterial for the floating island.
//
// Hemispheric lighting model: warm HEMI_SKY_COLOR from +Y, cool
// HEMI_GROUND_COLOR from -Y, blended by normal.y. No sun direction
// involved — the island is self-lit and independent of the city's
// day/night cycle.

import * as THREE from 'three';
import { ISLAND } from '@/state/stores/settings/island';

import vertSrc from './island.vert.glsl?raw';
import fragSrc from './island.frag.glsl?raw';

export function createIslandMaterial(): THREE.ShaderMaterial {
  const mats = ISLAND.value;
  return new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    uniforms: {
      uGrassTexture: { value: mats.GRASS_TEXTURE },
      uGrassPatchSize: { value: mats.GRASS_PATCH_SIZE },
      uRockTexture: { value: mats.ROCK_TEXTURE },
      uRockPatchSize: { value: mats.ROCK_PATCH_SIZE },
      uHemiSkyColor: { value: new THREE.Color(mats.HEMI_SKY_COLOR) },
      uHemiGroundColor: { value: new THREE.Color(mats.HEMI_GROUND_COLOR) },
    },
    side: THREE.FrontSide,
    toneMapped: true,
    // Bias the island AWAY from the camera in the depth buffer so city
    // surfaces (sidewalks, asphalt, footprint slab) always win the depth
    // contest against the island top. They're exactly coplanar at y=0, so this
    // is the ONLY thing separating them: the island used to be dropped to y=-2
    // as well, which grounded nothing and floated everything. Factor/units
    // bumped 1→4 because at city-scale (thousands of wu wide) the depth
    // precision near far-clip degrades and 1/1 wasn't enough margin.
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  });
}
