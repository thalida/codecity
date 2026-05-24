// label.vert.glsl — Per-instance flat label quad.
//
// Geometry: PlaneGeometry(1, 1) lying in the XY plane; the caller
// positions each instance in world space via instanceMatrix (which
// includes position, orientation, and scale).
//
// Per-instance attributes:
//   iUvRect — (u, v, w, h) atlas sub-rectangle in [0,1] space
//   iFlip   — 0.0 = normal, 1.0 = horizontally flipped
//
// COMPILATION NOTES (Three.js ShaderMaterial, v0.184.0):
//   - `instanceMatrix` (mat4) is injected under #ifdef USE_INSTANCING.
//   - `position`, `uv` are always injected by Three.js.
//   - `flat varying` → `flat out` (vertex) / `flat in` (fragment).

attribute vec4 iUvRect;   // (u0, v0, rectW, rectH) in atlas UV space
attribute float iFlip;    // 0 = normal, 1 = horizontally mirrored

varying vec2 vUv;
flat varying vec4 vUvRect;
flat varying float vFlip;

void main() {
  vUv = uv;
  vUvRect = iUvRect;
  vFlip = iFlip;

  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
