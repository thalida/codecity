
attribute vec2 aHalfExtent;
attribute float aOpacity;
varying vec2 vP;
varying vec2 vHalfExtent;
varying float vOpacity;
void main() {
  // The unit quad's vertex sits in [-0.5, 0.5] on x and z (PlaneGeometry
  // rotated -π/2 about X). Doubling and multiplying by the per-instance
  // half-extent gives the world-space offset from the instance center
  // in world units, which the fragment shader uses for the SDF.
  vP = position.xz * 2.0 * aHalfExtent;
  vHalfExtent = aHalfExtent;
  vOpacity = aOpacity;
  // instanceMatrix is auto-bound by InstancedMesh.
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
