
precision mediump float;
uniform vec3 uColor;
uniform vec3 uRuinColor;
uniform float uCornerRadius;
varying vec2 vP;
varying vec2 vHalfExtent;
varying float vOpacity;
varying float vRuin;
void main() {
  // Per-instance clamp: a radius larger than the smallest half-extent
  // would turn the rect into a pill/ellipse. Small rects (e.g. a
  // narrow building inflated by HALO_WIDTH) degrade gracefully.
  float r = min(uCornerRadius, min(vHalfExtent.x, vHalfExtent.y));
  // Inigo Quilez rounded-box SDF in world units.
  vec2 q = abs(vP) - vHalfExtent + r;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  if (d > 0.0) discard;
  // Ruined plots/roads (Timeline mode) tint toward the ruin color.
  gl_FragColor = vec4(mix(uColor, uRuinColor, vRuin), vOpacity);
}
