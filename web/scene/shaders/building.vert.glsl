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
//   - The material building this shader must enable USE_INSTANCING and
//     USE_INSTANCING_COLOR so those attributes are declared before this body.

attribute vec2 iCols;           // (cols_ew, cols_ns) — window column counts
attribute float iFloors;        // window row count
attribute float iOrient;        // 0=S, 1=N, 2=E, 3=W (door face)
attribute float iDoorWidth;     // door world-width
// Packed fader state in a single vec3 attribute (1 slot instead of 3) so
// we stay under GL_MAX_VERTEX_ATTRIBS=16. Unpacked to the three existing
// varyings in main(). Mutated at runtime by scene/effects/buildingFader.ts.
//   .x = opacity        — [0..1] alpha for body fade
//   .y = silhouette     — 0 = full facade, 1 = solid silhouette
//   .z = outlineOpacity — [0..1] outline alpha for Hidden tier wireframe
attribute vec3 iFade;
// Packed attribute (stays under GL_MAX_VERTEX_ATTRIBS=16):
//   .xy = top-left UV of file-icon slot in the atlas, or (-1,-1) for "no icon"
//   .z  = per-file random in [0, 1] driving the window gap / lit hash
//   .w  = createdAge — 0 (newest file) to 1 (oldest), repo-relative.
//         Independent of modifiedAge; drives grime/weathering.
attribute vec4 iIconUV;
// Per-instance modifiedAge in [0, 1]. 0 = most recently modified
// (vivid, fully lit windows); 1 = longest-untouched (dim, mostly
// dark windows). Mirrors iIconUV.w (createdAge) in polarity but
// keyed off the modified-date axis. Used in the fragment shader's
// renderWallFace via vModifiedAge.
attribute float iModifiedAge;

// Max age-tilt in radians (config: BUILDING_AGING.TILT_DEGREES → radians;
// or 0 when TILT_ENABLED is off). Pushed from refreshBuildingMaterial.
uniform float uTiltMaxRad;

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
flat varying vec4 vIconUV;      // pass-through of iIconUV; .xy = atlas UV, .z = seed, .w = createdAge
flat varying float vModifiedAge; // pass-through of iModifiedAge
varying float vWorldY;          // world-space height, for height-based ground haze in frag
varying vec3 vWorldPos;         // world-space position, for distance fog in frag

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
  vOpacity = iFade.x;
  vSilhouette = iFade.y;
  vOutlineOpacity = iFade.z;
  vIconUV = iIconUV;
  vModifiedAge = iModifiedAge;
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
  // Defensive guard: if a building somehow ends up with zero scale on the
  // axis this face's normal points along, the matrix-multiplied normal is
  // a zero vector and normalize() would return NaN. Fall back to world-up
  // so the lambert dot in the fragment shader stays finite (the resulting
  // lighting is wrong for that face, but a degenerate building is a worse
  // problem than slight mis-shading on it).
  vec3 worldN = mat3(modelMatrix * instanceMatrix) * normal;
  vWorldNormal = length(worldN) > 1e-6 ? normalize(worldN) : vec3(0.0, 1.0, 0.0);

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);

  // Age-driven tilt — lean MAGNITUDE is determined solely by
  // createdAge × uTiltMaxRad, so every building of the same age leans
  // by the same amount. Only the DIRECTION varies per building,
  // hashed from the per-file seed → a circle of equal-magnitude
  // leans pointing every which way across the city. Small-angle
  // approximation: lateral offset = worldY × magnitude × unit dir.
  // Base (Y=0) stays planted; top drifts.
  float tiltAngle = iIconUV.w * uTiltMaxRad;
  float tiltTheta = iIconUV.z * 6.2831853;
  vec2 tiltDir = vec2(cos(tiltTheta), sin(tiltTheta));
  worldPos.xz += worldPos.y * tiltAngle * tiltDir;

  vWorldY = worldPos.y;
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
