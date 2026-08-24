// holoQuad.vert.glsl — Passthrough vertex shader for the Hologram
// style's text panel and beam.

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
