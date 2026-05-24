// sky.frag.glsl — Cyberpunk Valley procedural sky.
//
// Inputs:
//   vViewDirWorld — unit world-space direction from the camera through
//                   this fragment (set by sky.vert.glsl). y in [-1, 1].
//
// Composition:
//   1. Solid uSkyColor everywhere. The world floor mesh handles the
//      real ground; past its edge the camera sees the sky directly
//      and the plane reads as floating in space.
//   2. Hashed point-star field with per-star sine twinkle driven by
//      uTime, painted across the FULL sphere — stars surround the
//      camera in every direction, including below the horizon line.
//
// All sky output is written directly to gl_FragColor in sRGB-encoded
// display space — the postFx pipeline's OutputPass + ACES tonemapping
// converts the >1.0 HDR pixels back to display range.
//
// depthWrite is false on the material (set in sky.ts) so the sphere
// never occludes other geometry; combined with renderOrder=SKY=-1000
// this guarantees the sky is the first thing the composer draws.

varying vec3 vViewDirWorld;

// --- Sky ---
uniform vec3 uSkyColor;           // solid fill for the entire sphere.

// --- Stars ---
uniform float uStarsEnabled;
uniform float uStarDensity;       // hash threshold for star presence
uniform float uStarSize;          // star spot radius as fraction of cell (0..0.5);
                                  // sub-cell circular rendering with smoothstep edge
uniform float uStarBrightness;
uniform float uTwinkleEnabled;
uniform float uTwinkleSpeed;
uniform float uTwinkleAmplitude;  // 0=no twinkle, 1=full on/off
uniform float uTime;              // seconds; advanced once per frame

// Standard sin-fract pseudo-random — same as building.frag.glsl's hash21.
// Deterministic per (cell.x, cell.y) so a given sky direction always
// hashes to the same star presence + phase across frames.
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Equirectangular (longitude, latitude) projection. Longitude wraps over
// [-π, π], latitude over [-π/2, π/2]. Near the poles the projection
// distorts star density slightly — acceptable for a starfield where
// the eye doesn't measure spacing.
vec2 starUV(vec3 dir) {
  return vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
}

void main() {
  vec3 dir = normalize(vViewDirWorld);

  // ----- Sky base color -----
  vec3 color = uSkyColor;

  // ----- Stars (full sphere) -----
  if (uStarsEnabled > 0.5) {
    // Cell scale in radians^-1: ~100 cells per radian gives roughly
    // 0.57° cells, coarse enough to keep neighbouring cells visually
    // distinct. Stars render as a small circular dot anchored at a
    // random point within the cell — the cell itself is just the
    // candidate domain, not the visible star.
    vec2 sv = starUV(dir) * 100.0;
    vec2 cell = floor(sv);
    vec2 inCell = fract(sv); // [0, 1] position within the cell
    float h = hash21(cell);
    // hash > 1 - DENSITY ⇒ this cell holds a star.
    if (h > 1.0 - uStarDensity) {
      // Random center within the cell so stars don't snap to a grid.
      vec2 starCenter = vec2(
        hash21(cell + vec2(7.0, 0.0)),
        hash21(cell + vec2(0.0, 13.0))
      );
      float distToCenter = length(inCell - starCenter);
      // Circular falloff: solid inside the inner half of uStarSize,
      // smooth fade out to the full uStarSize radius.
      float r = max(uStarSize, 1e-4);
      float circle = 1.0 - smoothstep(r * 0.5, r, distToCenter);
      if (circle > 0.0) {
        // Per-star phase: a second hash on the cell shifts when this
        // star peaks. Combined with uTime each star twinkles
        // independently.
        float phase = hash21(cell + vec2(31.4, 17.7));
        float starAmt = uStarBrightness * circle;
        if (uTwinkleEnabled > 0.5 && uTwinkleAmplitude > 0.0) {
          // PHASE_SPEED_BIAS: per-star speed multiplier in
          // [PHASE_SPEED_BIAS, PHASE_SPEED_BIAS+1] so two adjacent
          // stars never twinkle in lockstep. 0.5 = baseline; +phase
          // ramps it up to 1.5.
          // TAU = 2π, used to convert `phase` ∈ [0,1) into a full
          // sine-wave phase shift so the per-star sine starts at a
          // uniformly random point in its cycle.
          const float PHASE_SPEED_BIAS = 0.5;
          const float TAU = 6.2831853;
          float t = sin(uTime * uTwinkleSpeed * (PHASE_SPEED_BIAS + phase) + phase * TAU);
          float mod_ = 1.0 + t * uTwinkleAmplitude;
          starAmt *= max(mod_, 0.0);
        }
        // Stars are white-warm; add to the sky color rather than
        // mixing so a bright star reads against any background tint.
        color += vec3(starAmt);
      }
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
