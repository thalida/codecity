// impostor.vert.glsl — Mid-distance LOD tier for cell rendering.
// Same world-space transform as the detail tier so impostors slot
// in seamlessly when the LOD evaluator swaps tiers. Forwards the
// world-space normal so the fragment shader can apply the same
// directional sun + ambient lighting the detail facade uses
// — keeps colors / shading consistent across tier transitions.

attribute vec3 iColor;
attribute float iFade;
varying vec3 vColor;
varying float vFade;
varying vec3 vWorldNormal;

void main() {
  vColor = iColor;
  vFade  = iFade;
  // World-space normal: instanceMatrix is the per-instance world transform,
  // so multiplying the cube's local normal by it (with w=0 to skip translation)
  // gives the face's world-space normal. Buildings aren't rotated so each
  // face has a constant world normal across its surface.
  vWorldNormal = normalize((instanceMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
