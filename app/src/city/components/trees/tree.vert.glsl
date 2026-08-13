// tree.vert.glsl — merged tree chunks: vertices arrive pre-transformed to
// world space with all colors baked per-vertex (see treeRenderer's bake).
// Deliberately no instancing: instanced tree draws corrupt on mobile GPU
// drivers (Samsung Xclipse 950, both browser GL stacks); this is the same
// draw shape as roads, which never glitched. The commit index rides along
// for the timeline scrub gate (fragment discard).

attribute float aCommitIndex;

varying vec3 vColor;
varying float vCommitIndex;

#include <hash_glsl_inline>

// Two canopies sharing space have no depth order to speak of, so the buffer
// picks per pixel and the overlap stipples. This gives each tree a fixed place
// in the queue instead: same commit, same nudge, same winner every frame.
//
// In EYE space, in world units. The same nudge in clip space is a constant in
// NDC, and NDC z is nowhere near linear: far from the camera it buys a huge
// distance, enough to pull a distant tree in front of whatever should hide it,
// so trees popped into view while orbiting. Here it's the same small step at
// any distance. Well under a trunk's width, so it can't reorder trees that are
// genuinely apart, and it only has to beat the depth buffer's resolution.
const float DEPTH_NUDGE = 0.05;

void main() {
  vColor = color;
  vCommitIndex = aCommitIndex;
  vec4 eye = modelViewMatrix * vec4(position, 1.0);
  // The camera looks down -Z in eye space, so +Z is a step toward it.
  eye.z += hash11(aCommitIndex) * DEPTH_NUDGE;
  gl_Position = projectionMatrix * eye;
}
