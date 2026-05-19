// impostor.vert.glsl — Mid-distance LOD tier for cell rendering.
// Same world-space transform as the detail tier so impostors slot
// in seamlessly when the LOD evaluator swaps tiers. Forwards the
// world-space normal so the fragment shader can apply the same
// directional sun + ambient lighting the detail facade uses, and
// the world-space Y so it can apply the same height-based ground
// haze — keeps brightness consistent across tier transitions.

attribute vec3 iColor;
attribute float iFade;
varying vec3 vColor;
varying float vFade;
varying vec3 vWorldNormal;
varying float vWorldY;

void main() {
  vColor = iColor;
  vFade  = iFade;
  // World-space position: modelMatrix is identity for InstancedMesh, so
  // instanceMatrix carries the per-instance world transform.
  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorldY = worldPos.y;
  // World-space normal: instanceMatrix * vec4(normal, 0) (w=0 to skip
  // translation). Buildings aren't rotated so each face has a constant
  // world normal across its surface.
  vWorldNormal = normalize((instanceMatrix * vec4(normal, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
