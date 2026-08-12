// fireflies.vert.glsl — THREE.Points of glowing orbs, one VERTEX per orb.
// Each orb orbits its tree's vertical axis (XZ) while bobbing vertically;
// both are computed here so the CPU never rewrites buffers. Point size is
// the orb's world radius, perspective-projected to device pixels.
//
// Deliberately not instanced geometry: per-orb icospheres instanced by the
// thousand glitched a mobile driver (Samsung Xclipse) under BOTH browser GL
// stacks; a points draw is the smallest possible GPU surface for the same
// visual.

attribute float aPhase;
attribute float aPulsePhase;
attribute float aOrbitRadius; // world units
attribute float aOrbitStartAngle;
attribute float aOrbitTilt;
attribute float aCommitIndex;
attribute float aScale; // orb world radius

uniform float uTime;
uniform float uBobAmp;
uniform float uBobSpeed;
uniform float uPulseAmp;
uniform float uPulseSpeed;
uniform float uOrbitSpeed;
uniform float uHalfViewportHeight; // device pixels
uniform float uScrubCommit; // -1 = live (no gate)

varying float vPulse;
varying float vCommitIndex;
varying vec3 vInstanceColor;

void main() {
  vCommitIndex = aCommitIndex;
  vInstanceColor = color;

  // Timeline gate: park gated orbs at a finite clipped position (z > w) —
  // never a zero-w or NaN position, which some mobile drivers rasterize as
  // screen-covering garbage.
  if (uScrubCommit >= 0.0 && aCommitIndex > uScrubCommit) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vPulse = 0.0;
    return;
  }

  vec3 transformed = position;
  float orbitAngle = aOrbitStartAngle + uTime * uOrbitSpeed;
  float orbX = aOrbitRadius * cos(orbitAngle);
  float orbZ = aOrbitRadius * sin(orbitAngle);
  float ct = cos(aOrbitTilt);
  float st = sin(aOrbitTilt);
  transformed.x += orbX;
  transformed.y += -st * orbZ; // tilt pushes some motion into Y
  transformed.z += ct * orbZ;
  transformed.y += sin(uTime * uBobSpeed + aPhase) * uBobAmp;

  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // World radius → on-screen diameter in device pixels, clamped so close-up
  // orbs can't exceed the driver's point-size range.
  float sizePx = aScale * 2.0 * uHalfViewportHeight * projectionMatrix[1][1] / max(0.1, -mvPosition.z);
  gl_PointSize = clamp(sizePx, 1.0, 512.0);

  vPulse = 1.0 + uPulseAmp * sin(uTime * uPulseSpeed + aPulsePhase);
}
