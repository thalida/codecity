// label.frag.glsl — Sample the shared atlas texture for each label instance.
//
// vUvRect maps from local [0,1] plane UV → atlas sub-rect.
// vFlip mirrors the U axis so the label reads correctly regardless of
// camera orientation (flipping is controlled by _orientLabelsForCamera in
// main.ts writing iFlip per-instance rather than rotating a Group).

varying vec2 vUv;
flat varying vec4 vUvRect;
flat varying float vFlip;
uniform sampler2D uMap;

void main() {
  // iFlip is the instanced equivalent of the legacy Group's
  // `rotation.y = π` — that rotation flips a flat XZ plane along BOTH
  // its in-plane axes, so we mirror U and V together to match.
  float u = vFlip > 0.5 ? (1.0 - vUv.x) : vUv.x;
  float v = vFlip > 0.5 ? (1.0 - vUv.y) : vUv.y;
  vec2 atlasUv = vec2(vUvRect.x + u * vUvRect.z, vUvRect.y + v * vUvRect.w);
  vec4 c = texture2D(uMap, atlasUv);
  if (c.a < 0.01) discard;
  gl_FragColor = c;
}
