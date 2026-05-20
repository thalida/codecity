// sky.frag.glsl — Cyberpunk Valley procedural sky.
//
// Inputs:
//   vViewDirWorld — unit world-space direction from the camera through
//                   this fragment (set by sky.vert.glsl). y in [-1, 1].
//
// Layers, composited in order:
//   1. Vertical color gradient driven by vViewDirWorld.y mapped into
//      [0, 1] (1=zenith, 0=horizon) and ramped through five color stops.
//   2. Star field: a hash on a discretised UV picks star presence;
//      stars above min elevation only; brightness modulated by
//      sin(uTime * speed * phase + offset) when twinkle is enabled.
//   3. Moon disk + halo at a world direction supplied as a unit vec3.
//      Disk center is boosted by uMoonEmissionBoost so the HalfFloatType
//      EffectComposer target preserves the >1.0 value and the bloom
//      pass picks it up (see web/scene/postFx.ts).
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
uniform float uStarBrightness;
uniform float uTwinkleEnabled;
uniform float uTwinkleSpeed;
uniform float uTwinkleAmplitude;  // 0=no twinkle, 1=full on/off
uniform float uStarMinElevation;  // sin(MIN_ELEVATION_DEG), precomputed JS-side
uniform float uTime;              // seconds; advanced once per frame

// --- Moon ---
uniform float uMoonEnabled;
uniform vec3 uMoonDir;            // unit world direction TOWARD moon center
uniform float uMoonCosSize;       // cos(SIZE_DEG * 0.5), precomputed JS-side
uniform vec3 uMoonColor;
uniform vec3 uMoonHaloColor;
uniform float uMoonHaloMult;      // halo size multiplier × disk size
uniform float uMoonEmissionBoost; // >1 pushes moon into HDR for bloom

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

// Project a unit world direction onto a 2D plane indexed by sky cells.
// Avoids the pole-singularity of (atan(z,x), asin(y)) by using the
// equirectangular-ish (x/(1+|y|), z/(1+|y|)) compression: directions
// near the zenith get pulled toward the origin, so the per-cell hash
// scatter stays roughly uniform across the upper hemisphere.
vec2 starUV(vec3 dir) {
  float k = 1.0 / (1.0 + abs(dir.y));
  return vec2(dir.x * k, dir.z * k);
}

void main() {
  // vViewDirWorld is normalized (sky.vert.glsl). y in [-1, 1] where
  // 1=zenith, -1=nadir. The icosphere covers the full sphere; the
  // lower hemisphere is also visible while the camera is below the
  // city's centerline, so we don't clip on y<0.
  vec3 dir = normalize(vViewDirWorld);

  // ----- Gradient (always present; ENABLED=0 is handled JS-side by
  // hiding the mesh, but the shader keeps the gradient even when
  // uGradientEnabled=0 so the disabled state still renders a meaningful
  // color before the mesh.visible flip propagates). -----
  float elev01 = clamp((dir.y + 1.0) * 0.5, 0.0, 1.0);
  vec3 color = sampleGradient(elev01);

  // ----- Stars -----
  // Only above MIN_ELEVATION_DEG (precomputed as sin(deg) on JS side).
  if (uStarsEnabled > 0.5 && dir.y > uStarMinElevation) {
    // Discretise the projected sky into cells. 512 cells across the
    // unit square gives a visually pleasing star density at the
    // default DENSITY threshold; the shader can pump this up to
    // thousands without measurable cost.
    vec2 sv = starUV(dir) * 512.0;
    vec2 cell = floor(sv);
    float h = hash21(cell);
    // hash < DENSITY ⇒ this cell holds a star. Spec phrases DENSITY
    // as "threshold for star presence" — higher density ⇒ more stars.
    float present = step(1.0 - uStarDensity, h);
    if (present > 0.5) {
      // Per-star phase: a second hash on the cell shifts when this
      // star peaks. Combined with uTime each star twinkles
      // independently.
      float phase = hash21(cell + vec2(31.4, 17.7));
      float starAmt = uStarBrightness;
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

  // ----- Moon -----
  if (uMoonEnabled > 0.5) {
    float dotMoon = dot(dir, uMoonDir);
    if (dotMoon > 0.0) {
      // Disk: hard-edged inside the cosine of the half-angular size.
      float diskMask = smoothstep(uMoonCosSize - 0.0005, uMoonCosSize + 0.0005, dotMoon);
      // Halo: soft falloff between disk edge and HALO_SIZE_MULT × disk.
      // Convert "size multiplier" to a cosine threshold by taking the
      // disk's half-angle (acos(uMoonCosSize)), multiplying by the
      // halo mult, and re-cosing. cos is monotone-decreasing on [0,π]
      // so this works for any HALO_SIZE_MULT >= 1.
      float diskHalfAngle = acos(clamp(uMoonCosSize, -1.0, 1.0));
      float haloHalfAngle = min(diskHalfAngle * max(uMoonHaloMult, 1.0), 3.14159);
      float haloCos = cos(haloHalfAngle);
      float haloMask = smoothstep(haloCos, uMoonCosSize, dotMoon) * (1.0 - diskMask);
      // Halo color blended over the gradient.
      color = mix(color, uMoonHaloColor, haloMask * 0.6);
      // Disk: replace gradient and push past 1.0 for HDR bloom.
      vec3 diskColor = uMoonColor * uMoonEmissionBoost;
      color = mix(color, diskColor, diskMask);
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
