// ringText.vert.glsl — Passthrough vertex shader for the repo-name ring.
// Forwards the torus's UV (u runs the long way around the ring, v runs
// across the tube) so the fragment shader can sample the text canvas
// along u and apply the glow falloff along v.

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
