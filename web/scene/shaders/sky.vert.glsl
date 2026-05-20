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
// transform is necessary. This keeps the gradient + star + ground
// math in the fragment trivial and independent of the camera (the camera
// moves inside the sphere; the fragment direction stays anchored to
// the world).

varying vec3 vViewDirWorld;

void main() {
  vViewDirWorld = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
