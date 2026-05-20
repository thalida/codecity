// sky.vert.glsl — Cyberpunk Valley procedural sky vertex shader.
//
// Geometry: an inverted icosphere (THREE.IcosahedronGeometry with
// BackSide material) centered at scene root. Each vertex's local
// position lies on a unit sphere (the icosphere is built with radius=1
// in JS and scaled via the mesh transform), so `normalize(position)`
// IS the outward view-direction vector for that fragment.
//
// We pass it to the fragment as a world-space varying — the sky mesh
// is never rotated, so its local axes equal world axes; no normalMatrix
// transform is necessary. This keeps the sky + star + ground
// math in the fragment trivial and independent of the camera (the camera
// moves inside the sphere; the fragment direction stays anchored to
// the world).
//
// Depth: the skybox depth trick (gl_Position.z = gl_Position.w) forces
// the sky sphere to always render at NDC z=1.0 (the far plane), regardless
// of its world-space distance from the camera. This makes far-plane clipping
// impossible even for sphere fragments at the frustum diagonals of small-repo
// viewports.

varying vec3 vViewDirWorld;

void main() {
  vViewDirWorld = normalize(position);
  vec4 projected = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Skybox depth trick: force z = w so z/w = 1.0 in NDC — the sphere
  // always renders AT the far plane regardless of its actual world-space
  // distance from the camera. Without this, sphere fragments at the
  // frustum diagonals can poke past camera.far for small repos and the
  // rasterizer clips them, leaking scene.background through the corners.
  // Pairs with depthWrite:false (sky.ts) so nothing else is occluded by
  // the now-always-at-far depth value.
  gl_Position = projected.xyww;
}
