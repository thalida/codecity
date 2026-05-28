// fireflies.vert.glsl — InstancedMesh of additive-blended icospheres.
// Each instance orbits its tree's vertical axis (in XZ) while bobbing
// vertically (Y). The instance matrix translates to the tree center;
// orbit + bob are computed here so the CPU never re-writes matrices.

// Per-instance attributes (driven by InstancedBufferAttribute)
attribute float aPhase;
attribute float aPulsePhase;
attribute float aOrbitRadius;
attribute float aOrbitStartAngle;
attribute float aCommitIndex;

// Uniforms
uniform float uTime;
uniform float uBobAmp;
uniform float uBobSpeed;
uniform float uPulseAmp;
uniform float uPulseSpeed;
uniform float uOrbitSpeed;

// Varyings to fragment
varying float vPulse;
varying float vCommitIndex;
varying vec3 vViewNormal;
varying vec3 vInstanceColor;

void main() {
  // Compute orbital + bob displacement in instance-local space.
  vec3 transformed = position;
  float orbitAngle = aOrbitStartAngle + uTime * uOrbitSpeed;
  transformed.x += aOrbitRadius * cos(orbitAngle);
  transformed.z += aOrbitRadius * sin(orbitAngle);
  transformed.y += sin(uTime * uBobSpeed + aPhase) * uBobAmp;

  // Apply per-instance transform (Three.js auto-declares instanceMatrix
  // for InstancedMesh). Then model-view + projection.
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // View-space normal for the rim outline effect. The icosphere's
  // local normal transformed through (modelView × instanceMatrix).
  // For uniform-scale instance matrices (our case), mat3 of the matrix
  // is sufficient — no inverse-transpose needed.
  vViewNormal = normalize(mat3(modelViewMatrix * instanceMatrix) * normal);

  // Pass per-orb pulse + commit index to fragment.
  vPulse = 1.0 + uPulseAmp * sin(uTime * uPulseSpeed + aPulsePhase);
  vCommitIndex = aCommitIndex;

  // Per-instance color (Three.js auto-declares instanceColor when the
  // material has vertexColors=true AND the InstancedMesh has setColorAt).
  vInstanceColor = instanceColor;
}
