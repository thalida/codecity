// fireflies.vert.glsl — THREE.Points of glowing orbs, one VERTEX per orb.
// Each orb orbits its tree's vertical axis (XZ) while bobbing vertically;
// both are computed here so the CPU never rewrites buffers. Point size is
// the orb's world radius, perspective-projected to device pixels.
//
// Deliberately not instanced geometry: per-orb icospheres instanced by the
// thousand glitched a mobile driver (Samsung Xclipse) under BOTH browser GL
// stacks; a points draw is the smallest possible GPU surface for the same
// visual.

// On-screen diameter cap, device pixels. At the default 45° FOV on a
// 1800px-tall buffer, the largest orb (SCALE_MAX = 5) reaches this at ~170
// world units and stops growing past it; a mid-size orb reaches it at ~68.
// Raising it re-buys that growth at 4x the worst-case fill per doubling.
#define MAX_POINT_SIZE_PX 128.0

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

  // World radius → on-screen diameter in device pixels, capped by
  // MAX_POINT_SIZE_PX. The cap is a fill-rate budget, not a driver limit:
  // orbs are additive with depthWrite off, so nothing rejects them early and
  // every covered pixel blends. One orb at 512px was ~206k blended fragments
  // (the frag discards outside r=1), so a handful of near orbs cost about a
  // full-screen pass. At 128 that worst case drops 16x.
  float sizePx = aScale * 2.0 * uHalfViewportHeight * projectionMatrix[1][1] / max(0.1, -mvPosition.z);
  gl_PointSize = clamp(sizePx, 1.0, MAX_POINT_SIZE_PX);

  vPulse = 1.0 + uPulseAmp * sin(uTime * uPulseSpeed + aPulsePhase);
}
