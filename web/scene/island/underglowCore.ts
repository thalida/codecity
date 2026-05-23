// scene/island/underglowCore.ts — Emissive icosphere nested under the
// island's bottom cluster. HDR-emissive (output > 1.0) so the existing
// ACES + bloom post-FX picks it up and blooms it into a soft halo.

import * as THREE from 'three';
import { ISLAND_UNDERGLOW } from '@/config/island.js';

export interface UnderglowCore {
  mesh: THREE.Mesh;
  refresh(): void;
  dispose(): void;
}

export interface UnderglowCoreParams {
  bottomY: number;
  bottomRadius: number;
}

const fragSrc = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  // HDR emissive: output above 1.0 so bloom catches it.
  gl_FragColor = vec4(uColor * uIntensity, 1.0);
}
`;

const vertSrc = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function createUnderglowCore(params: UnderglowCoreParams): UnderglowCore {
  const ug = ISLAND_UNDERGLOW.get();
  // Slightly larger radius so the bloom halo radiates further through the
  // tier seams. The mesh itself is hidden inside the bottom tier cluster.
  const radius = params.bottomRadius * 0.55;
  const geom = new THREE.IcosahedronGeometry(radius, 0); // low-poly
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertSrc,
    fragmentShader: fragSrc,
    uniforms: {
      uColor: { value: new THREE.Color(ug.COLOR) },
      uIntensity: { value: ug.CORE_INTENSITY },
    },
    toneMapped: false,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geom, mat);
  // Position the core ABOVE the bottom cap, nested inside the lowest tier
  // ring cluster. Bloom halo leaks out through rock seams without the core
  // itself being directly visible from any side angle.
  mesh.position.set(0, params.bottomY + radius * 0.5, 0);
  mesh.visible = ug.CORE_ENABLED && ug.ENABLED;
  mesh.userData.island = 'underglowCore';

  function refresh(): void {
    const u = ISLAND_UNDERGLOW.get();
    (mat.uniforms.uColor!.value as THREE.Color).set(u.COLOR);
    mat.uniforms.uIntensity!.value = u.CORE_INTENSITY;
    mesh.visible = u.CORE_ENABLED && u.ENABLED;
  }

  function dispose(): void {
    if (mesh.parent) mesh.parent.remove(mesh);
    geom.dispose();
    mat.dispose();
  }

  return { mesh, refresh, dispose };
}
