// tree.frag.glsl — flat unlit color. All shading is baked per-vertex at
// build time (see treeRenderer's bakeVertexShading); output stays linear —
// the composer's OutputPass owns tonemapping + sRGB for the whole frame.

precision highp float;

varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
