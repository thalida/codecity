// sky.frag.glsl — Cyberpunk Valley procedural sky.
//
// Inputs:
//   vViewDirWorld — unit world-space direction from the camera through
//                   this fragment (set by sky.vert.glsl). y in [-1, 1].
//
// Layers, composited in order:
//   1. Below dir.y=0: solid uGroundColor fill (lower hemisphere). No
//      gradient, no stars. Produces a clean horizon line.
//   2. Above dir.y=0: vertical color gradient mirrored around the
//      horizon — HORIZON color at the horizon band, TOP color at the
//      zenith, mid colors interpolating between.
//   3. Above MIN_ELEVATION_DEG: hashed point-star field with
//      per-star sine twinkle driven by uTime.
//
// All sky output is written directly to gl_FragColor in sRGB-encoded
// display space — the postFx pipeline's OutputPass + ACES tonemapping
// converts the >1.0 HDR pixels back to display range. Following the
// same convention as building.frag.glsl: ShaderMaterial gets no
// automatic linear→sRGB conversion, so colors handed in via uniforms
// are also already in sRGB (the JS side passes them with
// THREE.LinearSRGBColorSpace; see sky.ts).
//
// depthWrite is false on the material (set in sky.ts) so the sphere
// never occludes other geometry; combined with renderOrder=SKY=-1000
// this guarantees the sky is the first thing the composer draws.

varying vec3 vViewDirWorld;

// --- Gradient ---
uniform float uGradientEnabled;   // 1.0 / 0.0 (the JS factory also
                                  // hides the mesh when 0, but the
                                  // shader still respects the flag so
                                  // a one-frame stutter on toggle
                                  // doesn't paint a transitional color)
uniform vec3 uGradientTop;
uniform vec3 uGradientUpperMid;
uniform vec3 uGradientMid;
uniform vec3 uGradientLowerMid;
uniform vec3 uGradientHorizon;
uniform float uStopTop;
uniform float uStopUpperMid;
uniform float uStopMid;
uniform float uStopLowerMid;
uniform float uStopHorizon;

// --- Stars ---
uniform float uStarsEnabled;
uniform float uStarDensity;       // hash threshold for star presence
uniform float uStarSize;          // star spot radius as fraction of cell (0..0.5);
                                  // sub-cell circular rendering with smoothstep edge
uniform float uStarBrightness;
uniform float uTwinkleEnabled;
uniform float uTwinkleSpeed;
uniform float uTwinkleAmplitude;  // 0=no twinkle, 1=full on/off
uniform float uStarMinElevation;  // sin(MIN_ELEVATION_DEG), precomputed JS-side
uniform float uTime;              // seconds; advanced once per frame

// --- Ground (below-horizon solid fill) ---
uniform vec3 uGroundColor;        // solid fill for dir.y < 0 (the lower
                                  // hemisphere). Painted directly with no
                                  // gradient / stars / moon — produces a
                                  // clean horizon line and removes the
                                  // need for a separate floor mesh.

// Standard sin-fract pseudo-random — same as building.frag.glsl's hash21.
// Deterministic per (cell.x, cell.y) so a given sky direction always
// hashes to the same star presence + phase across frames.
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Five-stop color ramp by elevation t in [0, 1]; 1=zenith, 0=horizon.
vec3 sampleGradient(float t) {
  // Each segment is a linear interpolation between adjacent stops.
  // Step function: pick the segment whose stop pair brackets t.
  // (Order of stops is enforced by the spec: TOP=0 < UPPER_MID < MID
  // < LOWER_MID < HORIZON. UI can violate this; the clamps + step
  // ordering below degrade gracefully — top color extends if a stop
  // crosses neighbors.)
  if (t <= uStopUpperMid) {
    float u = (t - uStopTop) / max(uStopUpperMid - uStopTop, 1e-5);
    return mix(uGradientTop, uGradientUpperMid, clamp(u, 0.0, 1.0));
  }
  if (t <= uStopMid) {
    float u = (t - uStopUpperMid) / max(uStopMid - uStopUpperMid, 1e-5);
    return mix(uGradientUpperMid, uGradientMid, clamp(u, 0.0, 1.0));
  }
  if (t <= uStopLowerMid) {
    float u = (t - uStopMid) / max(uStopLowerMid - uStopMid, 1e-5);
    return mix(uGradientMid, uGradientLowerMid, clamp(u, 0.0, 1.0));
  }
  if (t <= uStopHorizon) {
    float u = (t - uStopLowerMid) / max(uStopHorizon - uStopLowerMid, 1e-5);
    return mix(uGradientLowerMid, uGradientHorizon, clamp(u, 0.0, 1.0));
  }
  return uGradientHorizon;
}

// Equirectangular (longitude, latitude) projection. Longitude wraps over
// [-π, π], latitude over [-π/2, π/2]. Outside the polar zone (which we
// gate off with uStarMinElevation anyway) this gives a roughly uniform
// star distribution — far more even than the (x/(1+|y|), z/(1+|y|))
// polar compression, which created visible diagonal star streaks
// emanating from the zenith.
vec2 starUV(vec3 dir) {
  return vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
}

void main() {
  // vViewDirWorld is normalized (sky.vert.glsl). y in [-1, 1] where
  // 1=zenith, -1=nadir. The icosphere covers the full sphere.
  vec3 dir = normalize(vViewDirWorld);

  // ----- Lower hemisphere: solid ground fill -----
  // Below the horizon line we paint uGroundColor directly. No
  // gradient, no stars, no moon. This is the visual ground — no
  // separate floor mesh is needed. The hard threshold at dir.y=0
  // creates a clean horizon line where this solid color meets the
  // upper-hemisphere gradient's HORIZON stop.
  if (dir.y < 0.0) {
    gl_FragColor = vec4(uGroundColor, 1.0);
    return;
  }

  // ----- Upper hemisphere -----
  // Gradient: mirror around the horizon. HORIZON color lands AT the
  // horizon line (dir.y → 0 → elev01 → 1 → returns HORIZON), TOP lands
  // at the zenith (dir.y → 1 → abs → 1 → elev01 → 0 → returns TOP).
  float elev01 = 1.0 - clamp(abs(dir.y), 0.0, 1.0);
  vec3 color = sampleGradient(elev01);

  // ----- Stars -----
  // Only above MIN_ELEVATION_DEG (precomputed as sin(deg) on JS side).
  if (uStarsEnabled > 0.5 && dir.y > uStarMinElevation) {
    // Cell scale in radians^-1: ~100 cells per radian gives roughly
    // 0.57° cells, coarse enough to keep neighbouring cells visually
    // distinct. Stars render as a small circular dot anchored at a
    // random point within the cell — the cell itself is just the
    // candidate domain, not the visible star.
    vec2 sv = starUV(dir) * 100.0;
    vec2 cell = floor(sv);
    vec2 inCell = fract(sv); // [0, 1] position within the cell
    float h = hash21(cell);
    // hash > 1 - DENSITY ⇒ this cell holds a star. Spec phrases
    // DENSITY as "threshold for star presence" — higher density ⇒
    // more stars.
    if (h > 1.0 - uStarDensity) {
      // Random center within the cell so stars don't snap to a grid.
      // Two extra hashes per cell stay cheap (same hash21 function).
      vec2 starCenter = vec2(
        hash21(cell + vec2(7.0, 0.0)),
        hash21(cell + vec2(0.0, 13.0))
      );
      float distToCenter = length(inCell - starCenter);
      // Circular falloff: solid inside the inner half of uStarSize,
      // smooth fade out to the full uStarSize radius. clamp on the
      // inner edge so SIZE=0 doesn't divide-by-zero.
      float r = max(uStarSize, 1e-4);
      float circle = 1.0 - smoothstep(r * 0.5, r, distToCenter);
      if (circle > 0.0) {
        // Per-star phase: a second hash on the cell shifts when this
        // star peaks. Combined with uTime each star twinkles
        // independently.
        float phase = hash21(cell + vec2(31.4, 17.7));
        float starAmt = uStarBrightness * circle;
        if (uTwinkleEnabled > 0.5 && uTwinkleAmplitude > 0.0) {
          float t = sin(uTime * uTwinkleSpeed * (0.5 + phase) + phase * 6.2831);
          // Remap sin from [-1, 1] to [1 - A, 1 + A], then floor at 0
          // so a fully-twinkled star can flicker off momentarily.
          float mod_ = 1.0 + t * uTwinkleAmplitude;
          starAmt *= max(mod_, 0.0);
        }
        // Stars are white-warm; add to the gradient color rather than
        // mixing so a bright star reads against any background tint.
        color += vec3(starAmt);
      }
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
