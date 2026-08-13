// tree.vert.glsl — merged tree chunks: vertices arrive pre-transformed to
// world space with all colors baked per-vertex (see treeRenderer's bake).
// Deliberately no instancing: instanced tree draws corrupt on mobile GPU
// drivers (Samsung Xclipse 950, both browser GL stacks); this is the same
// draw shape as roads, which never glitched. The commit index rides along
// for the timeline scrub gate (fragment discard).

attribute float aCommitIndex;

varying vec3 vColor;
varying float vCommitIndex;

void main() {
  vColor = color;
  vCommitIndex = aCommitIndex;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
