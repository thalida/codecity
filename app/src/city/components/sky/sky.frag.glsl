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

// --- Aurora (domain-warped gem nebula) ---
// Ported from LandingBackdrop's fbm domain warp, but 3D over the world
// view direction so the nebula wraps the full sphere seamlessly (the
// island floats in space, so the lower hemisphere is visible too).
float auroraHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float auroraNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(auroraHash(i + vec3(0.0, 0.0, 0.0)), auroraHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(auroraHash(i + vec3(0.0, 1.0, 0.0)), auroraHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(auroraHash(i + vec3(0.0, 0.0, 1.0)), auroraHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(auroraHash(i + vec3(0.0, 1.0, 1.0)), auroraHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float auroraFbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * auroraNoise(p); p = p * 2.0 + 11.3; a *= 0.5; }
  return v;
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

  // ----- Aurora (gem-hued nebula across the full sphere) -----
  // The domain IS the world view direction, so the nebula wraps the whole
  // sky with no seam or pole distortion — right for a city floating in space.
  // First-pass values are hardcoded and subtle; gems become theme uniforms later.
  {
    const vec3 GEM_CYAN    = vec3(0.149, 0.898, 1.000);
    const vec3 GEM_PURPLE  = vec3(0.600, 0.251, 1.000);
    const vec3 GEM_MAGENTA = vec3(1.000, 0.200, 0.549);
    const vec3 GEM_LIME    = vec3(0.749, 1.000, 0.200);

    const float SCALE = 1.6;      // domain frequency: lower = broader forms
    const float INTENSITY = 0.16; // peak add-on, kept under bloom threshold (0.5)

    vec3 p = dir * SCALE;
    float t = uTime * 0.006; // very slow drift

    // Inigo Quilez domain warp — bends the hue ramp into curved ribbons.
    vec3 q = vec3(
      auroraFbm(p + vec3(0.0, t, 0.0)),
      auroraFbm(p + vec3(5.2, 1.3, 2.8) - vec3(0.0, t, 0.0)),
      auroraFbm(p + vec3(1.7, 9.2, 4.4))
    );
    vec3 r = vec3(
      auroraFbm(p + 2.0 * q + vec3(1.7, 9.2, 0.0) + 0.5 * t),
      auroraFbm(p + 2.0 * q + vec3(8.3, 2.8, 5.1)),
      auroraFbm(p + 2.0 * q + vec3(2.9, 6.3, 1.2))
    );
    float f = auroraFbm(p + 2.0 * r);

    // Hue sweep through the gems, bent by the warp: cyan->purple->magenta->lime.
    float h = clamp(0.5 + 1.0 * (r.x - 0.5) + 0.6 * (q.y - 0.5), 0.0, 1.0);
    vec3 gem = GEM_CYAN;
    gem = mix(gem, GEM_PURPLE, smoothstep(0.12, 0.40, h));
    gem = mix(gem, GEM_MAGENTA, smoothstep(0.40, 0.66, h));
    gem = mix(gem, GEM_LIME, smoothstep(0.66, 0.90, h));

    // Ridge mask so it reads as discrete wisps, not a flat wash.
    float energy = smoothstep(0.42, 0.85, f);

    color += gem * (energy * INTENSITY);
  }

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
