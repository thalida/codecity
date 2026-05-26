// holoBeam.frag.glsl — Vertical light column from the gem up to the
// label. Alpha fades from 0.6 at the base (v=0) to 0 at the top (v=1).
// Color is cyan with a magenta tint at the cylinder's outer rim.

varying vec2 vUv;

uniform float uOpacity;

void main() {
  // Vertical fade — base is the cylinder's bottom in UV space.
  float vFade = 1.0 - vUv.y;
  float a = vFade * 0.6;

  // Side tint — vUv.x runs around the cylinder; tint magenta near
  // the seam where the U coordinate hits 0/1.
  float rim = abs(vUv.x - 0.5) * 2.0;
  vec3 cyan = vec3(0.2, 1.0, 1.0);
  vec3 magenta = vec3(1.0, 0.2, 0.9);
  vec3 color = mix(cyan, magenta, rim * 0.5);

  gl_FragColor = vec4(color, a * uOpacity);
}
