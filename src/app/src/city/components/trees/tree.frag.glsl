// tree.frag.glsl — flat unlit color; shading is baked per-vertex at build
// time (see treeRenderer's bakeVertexShading). Output stays linear — the
// composer's OutputPass owns tonemapping + sRGB for the whole frame.

precision highp float;

varying vec3 vColor;
varying float vCommitIndex;

uniform float uScrubCommit; // -1 = live (no gate)

void main() {
  if (uScrubCommit >= 0.0 && vCommitIndex > uScrubCommit) discard;
  gl_FragColor = vec4(vColor, 1.0);
}
