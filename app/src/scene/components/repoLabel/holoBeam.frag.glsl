// holoBeam.frag.glsl — Vertical light column rising from the gem to
// the label. Alpha is brightest at the gem (cylinder base) and fades
// out toward the panel (cylinder top). Color is cyan with a magenta
// tint at the cylinder's outer rim.
//
// three.js CylinderGeometry maps v=0 to the TOP of the cylinder and
// v=1 to the bottom, so we use vUv.y directly (no `1.0 -`) to put the
// bright end at the gem.

varying vec2 vUv;

uniform float uOpacity;

void main() {
  // Vertical fade: bright at the gem (v=1 in CylinderGeometry's UV),
  // fading to invisible at the panel end (v=0).
  float vFade = vUv.y;
  float a = vFade * 0.85;

  // Side tint — vUv.x runs around the cylinder; tint magenta near
  // the seam where the U coordinate hits 0/1.
  float rim = abs(vUv.x - 0.5) * 2.0;
  vec3 cyan = vec3(0.2, 1.0, 1.0);
  vec3 magenta = vec3(1.0, 0.2, 0.9);
  vec3 color = mix(cyan, magenta, rim * 0.5);

  gl_FragColor = vec4(color, a * uOpacity);
}
