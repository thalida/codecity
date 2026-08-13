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
// Tiny on purpose. It only has to clear the depth buffer's resolution, and it
// pulls toward the camera, so anything larger would start hiding the tree's own
// outline (drawn from separate line geometry at the true depth).
const float DEPTH_NUDGE = 1e-4;

void main() {
  vColor = color;
  vCommitIndex = aCommitIndex;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Scaled by w so it's a constant offset in NDC at any distance.
  clip.z -= hash11(aCommitIndex) * DEPTH_NUDGE * clip.w;
  gl_Position = clip;
}
