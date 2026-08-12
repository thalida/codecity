// city/utils/safeLineMaterial.ts — the only way this app constructs a
// LineMaterial (fat lines): the stock shader's screen-direction normalize
// goes NaN on zero-length screen segments (duplicate point, vertical edge
// seen top-down), which Android GLES rasterizes as giant flickering triangles.

import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { NEUTRAL_POLYGON_OFFSET } from '@/city/utils/neutralPolygonOffset';

// String-based swap: the test pins the stock shader text so a three upgrade
// that rewrites it goes red instead of silently dropping the guard.
export const STOCK_NORMALIZE = 'dir = normalize( dir );';
export const GUARDED_NORMALIZE =
  'dir = ( dot( dir, dir ) > 0.0 ) ? normalize( dir ) : vec2( 1.0, 0.0 );';

type LineMaterialParams = ConstructorParameters<typeof LineMaterial>[0];

export function createSafeLineMaterial(params: LineMaterialParams): LineMaterial {
  // Lines draw after the polygonOffset users; program a zero bias explicitly
  // (see neutralPolygonOffset.ts).
  const material = new LineMaterial({ ...NEUTRAL_POLYGON_OFFSET, ...params });
  material.vertexShader = material.vertexShader.replace(STOCK_NORMALIZE, GUARDED_NORMALIZE);
  return material;
}
