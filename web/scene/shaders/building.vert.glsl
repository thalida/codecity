// building.vert.glsl — Per-instance scaled unit cube. Determines face
// index (0..5) from the geometry's normal so the fragment shader can
// branch per-face for window/door/roof/bottom rendering.
//
// Face indices (matches BoxGeometry material slot order):
//   0 = +X (east),  1 = -X (west),  2 = +Y (roof), 3 = -Y (bottom),
//   4 = +Z (south), 5 = -Z (north)
//
// COMPILATION NOTES (Three.js ShaderMaterial, v0.184.0):
//   - Three.js prepends `#version 300 es` and maps `attribute` → `in`,
//     `varying` → `out` (vertex) / `in` (fragment) via preprocessor defines.
//     So `attribute`/`varying` keywords here are correct for ShaderMaterial.
//   - `flat varying` becomes `flat out` (vertex) / `flat in` (fragment),
//     which is valid GLSL ES 3.00.
//   - `instanceMatrix` (mat4) is injected under `#ifdef USE_INSTANCING`.
//   - `instanceColor` (vec3) is injected under `#ifdef USE_INSTANCING_COLOR`.
//   - `position`, `normal`, `uv` are always injected by Three.js.
//   - The material built in Task 8 must enable USE_INSTANCING and
//     USE_INSTANCING_COLOR so those attributes are declared before this body.

attribute vec2 iCols;           // (cols_ew, cols_ns) — window column counts
attribute float iFloors;        // window row count
attribute float iOrient;        // 0=S, 1=N, 2=E, 3=W (door face)
attribute float iDoorWidth;     // door world-width
attribute float iOpacity;       // [0..1] alpha for fader
attribute float iSilhouette;    // 0 = full facade, 1 = solid silhouette (no windows/door/slab)
attribute float iOutlineOpacity; // [0..1] composite outline at face edges (Hidden tier wireframe)
// Packed attribute (stays under GL_MAX_VERTEX_ATTRIBS=16):
//   .xy = top-left UV of file-icon slot in the atlas, or (-1,-1) for "no icon"
//   .z  = per-file random in [0, 1] driving the window gap / lit hash
attribute vec3 iIconUV;

flat varying int vFace;         // 0..5
varying vec2 vUv;
varying vec3 vWorldNormal;
flat varying vec2 vCols;
flat varying float vFloors;
flat varying float vOrient;
flat varying float vDoorWidth;
flat varying float vOpacity;
flat varying float vSilhouette;
flat varying float vOutlineOpacity;
flat varying vec3 vColor;
flat varying vec3 vScale;       // (w, h, d) recovered from instance matrix
flat varying vec3 vIconUV;      // pass-through of iIconUV; .xy = atlas UV, .z = per-file random seed

void main() {
  // Geometry's normal in object space tells us which face this vertex
  // belongs to. Convert to a face index 0..5.
  if (normal.x > 0.5) vFace = 0;
  else if (normal.x < -0.5) vFace = 1;
  else if (normal.y > 0.5) vFace = 2;
  else if (normal.y < -0.5) vFace = 3;
  else if (normal.z > 0.5) vFace = 4;
  else vFace = 5;

  vUv = uv;
  vCols = iCols;
  vFloors = iFloors;
  vOrient = iOrient;
  vDoorWidth = iDoorWidth;
  vOpacity = iOpacity;
  vSilhouette = iSilhouette;
  vOutlineOpacity = iOutlineOpacity;
  vIconUV = iIconUV;
  // Three.js sets `instanceColor` automatically when an InstancedBufferAttribute
  // named `instanceColor` is added; access via the predefined uniform path.
  // For our case we declare it as a varying derived from a custom attribute.
  vColor = instanceColor;

  // Recover (w, h, d) from the instance matrix's scale — used by the
  // fragment shader to size door against face world width.
  vScale = vec3(
    length(vec3(instanceMatrix[0])),
    length(vec3(instanceMatrix[1])),
    length(vec3(instanceMatrix[2]))
  );

  // World-space normal for any future per-face lighting (currently unused).
  vWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);

  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
