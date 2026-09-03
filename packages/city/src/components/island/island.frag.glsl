
precision highp float;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying float vAO;
varying vec3 vWorldPos;
varying float vSurface; // 1 = grass, 0 = rock

uniform vec3 uHemiSkyColor;
uniform vec3 uHemiGroundColor;
uniform float uGrassTexture; // 0..1 lightness swing
uniform float uGrassPatchSize; // world units per patch
uniform float uRockTexture;
uniform float uRockPatchSize;

#include <hash_glsl_inline>

// Value noise over world XZ: hash the four corners of the patch grid and
// smoothstep between them, so patches read as soft mottling rather than tiles.
float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec3 n = normalize(vNormalWorld);

  // Hemispheric model: warm key light from +Y (sky), cool fill from -Y
  // (ground). Blend by normal.y so up-facing surfaces get the sky color,
  // down-facing get the ground color, side-facing gets the gradient.
  // Single coherent lighting model — no sun direction, no additive glow.
  float hemi = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 hemiTint = mix(uHemiGroundColor, uHemiSkyColor, hemi);
  vec3 lit = vColor * hemiTint * vAO;

  // Surface texture. A flat top cap shades to one constant colour (n.y is 1
  // everywhere), and an unvarying field reads as a backdrop rather than as a
  // surface running away from you: detail that compresses with distance is what
  // tells the eye it's looking at a plane. Grass and rock carry their own
  // strength and patch size, since one is ground you read distance across and
  // the other is a cliff face.
  float amount = mix(uRockTexture, uGrassTexture, vSurface);
  // `patch` is a reserved word in GLSL ES (tessellation), and reserving it
  // fails the compile, not the parse of anything nearby.
  float patchSize = mix(uRockPatchSize, uGrassPatchSize, vSurface);
  if (amount > 0.0) {
    // Sampled on world XZ so the pattern belongs to the ground rather than
    // swimming with the camera. Two octaves, the second at a third the weight,
    // so patches carry finer grain inside them.
    vec2 p = vWorldPos.xz / max(patchSize, 1.0);
    float grain = valueNoise(p) * 0.75 + valueNoise(p * 3.0) * 0.25;
    lit *= 1.0 + (grain - 0.5) * 2.0 * amount;
  }
  gl_FragColor = vec4(lit, 1.0);
}
