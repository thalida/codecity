// sky.frag.glsl — Cyberpunk Valley procedural sky.
//
// Inputs:
//   vViewDirWorld — unit world-space direction from the camera through
//                   this fragment (set by sky.vert.glsl). y in [-1, 1].
//
// Layers, composited in order:
//   1. Below dir.y=0: solid uSkyColor — the world floor mesh handles
//      real ground. No stars (gated by uStarMinElevation).
//   2. Above dir.y=0:
//        - Within dir.y < uHorizonHeight: smooth fade from uHorizonColor
//          (at the horizon line) up to uSkyColor (at the top of the band).
//        - Above the band: solid uSkyColor.
//   3. Above MIN_ELEVATION_DEG: hashed point-star field with
//      per-star sine twinkle driven by uTime. Rendered as small
//      circular sub-cell dots with anti-aliased edges.
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

// --- Sky (upper hemisphere fill) ---
uniform vec3 uSkyColor;           // solid fill for the upper hemisphere
                                  // above uHorizonHeight. Stars are
                                  // drawn on top when present.
uniform vec3 uHorizonColor;       // soft atmosphere glow at the horizon
                                  // line. Fades to uSkyColor over the
                                  // band 0 <= dir.y <= uHorizonHeight
                                  // via smoothstep.
uniform float uHorizonHeight;     // fraction of the upper hemisphere
                                  // occupied by the horizon glow band
                                  // (0..1). 0 disables the band.

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

// Standard sin-fract pseudo-random — same as building.frag.glsl's hash21.
// Deterministic per (cell.x, cell.y) so a given sky direction always
// hashes to the same star presence + phase across frames.
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Equirectangular (longitude, latitude) projection. Longitude wraps over
// [-π, π], latitude over [-π/2, π/2]. Outside the polar zone (which we
// gate off with uStarMinElevation anyway) this gives a roughly uniform
// star distribution.
vec2 starUV(vec3 dir) {
  return vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
}

void main() {
  vec3 dir = normalize(vViewDirWorld);

  // ----- Sky color + horizon glow band -----
  // Below the horizon (dir.y < 0) clamp to 0 so the sky color shows
  // solid — the world floor mesh handles real ground painting.
  float dy = max(dir.y, 0.0);
  vec3 color = uSkyColor;
  if (uHorizonHeight > 0.0 && dy < uHorizonHeight) {
    // Smooth fade from uHorizonColor at dir.y=0 to uSkyColor at
    // dir.y=uHorizonHeight. smoothstep gives an eased falloff so the
    // glow blends in without a hard inner edge.
    float t = smoothstep(0.0, 1.0, dy / max(uHorizonHeight, 1e-4));
    color = mix(uHorizonColor, uSkyColor, t);
  }

  // ----- Stars (only above MIN_ELEVATION_DEG) -----
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
          float t = sin(uTime * uTwinkleSpeed * (0.5 + phase) + phase * 6.2831);
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
