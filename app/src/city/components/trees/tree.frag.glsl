// tree.frag.glsl — flat unlit color. All shading is baked per-vertex at
// build time (see treeRenderer's bakeVertexShading); output stays linear —
// the composer's OutputPass owns tonemapping + sRGB for the whole frame.

precision highp float;

varying vec3 vColor;

#ifdef MERGED_TREES
varying float vCommitIndex;
uniform float uScrubCommit; // -1 = live (no gate)
#endif

void main() {
  #ifdef MERGED_TREES
  if (uScrubCommit >= 0.0 && vCommitIndex > uScrubCommit) discard;
  #endif
  gl_FragColor = vec4(vColor, 1.0);
}
