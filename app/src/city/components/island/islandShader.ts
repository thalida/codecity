// city/components/island/islandShader.ts — the island's material: hemispheric
// light alone, warm from above and cool from below. No sun, so it is unaffected
// by the city's own lighting.

import * as THREE from 'three';
import { ISLAND } from '@/state/settings/fields/island';

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
    // The city's flat surfaces are exactly coplanar with the island top, so
    // this bias is the only thing settling the contest between them.
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  });
}
