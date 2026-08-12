// tree.vert.glsl — minimal hand-written instanced vertex shader for tree
// canopies + trunks. The canopy was the scene's ONLY instanced use of a
// BUILT-IN three material program, and that program shape is what a Samsung
// Xclipse 950 Vulkan driver corrupts (full-screen canopy-colored flashes);
// the buildings' hand-written shader path draws clean on the same device,
// so the trees now compile the same way. Compilation notes mirror
// buildings/building.vert.glsl: instanceMatrix/instanceColor/color are
// injected by three under USE_INSTANCING / USE_INSTANCING_COLOR / USE_COLOR,
// all set automatically for an InstancedMesh + vertexColors material.

uniform vec3 uColor;

varying vec3 vColor;

void main() {
  // Material tint × baked facet shading (geometry color, canopy only) ×
  // per-tree age color (instanceColor, canopy only). Trunks carry neither
  // attribute, so their defines are off and uColor passes through alone.
  vec3 c = uColor;
  #ifdef USE_COLOR
  c *= color;
  #endif
  #ifdef USE_INSTANCING_COLOR
  c *= instanceColor;
  #endif
  vColor = c;

  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
