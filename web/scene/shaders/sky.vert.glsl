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
// Depth: no skybox depth trick. The sky sphere is sized at
// CAMERA_PERSPECTIVE.FAR * 0.95 (see sky.ts), and cameraRig.ts floors
// camera.far at that same value, so every vertex sits inside the far
// plane and the rasterizer never clips them. depthTest is also off
// (sky.ts) and renderOrder = SKY (-1000) draws the sky before anything
// writes depth, so an honest projection is the safest choice.
//
// We previously used the depth trick `gl_Position = projected.xyww` to
// force NDC z = 1.0, but that produces 0/0 NaN at any vertex with
// projected.w = 0. With the sphere centered on the camera (see
// sky-position sync in main.ts), every vertex on the great circle
// perpendicular to the view direction has view-space z = 0, so
// projected.w = 0 and the trick wrote NaN into clip coords. The NaN
// then interpolated across triangles and filled the HDR target with
// NaN pixels, which ACES tonemapped to black — observed as the city
// rendering into a narrow strip with the rest of the canvas black.

varying vec3 vViewDirWorld;

void main() {
  vViewDirWorld = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
