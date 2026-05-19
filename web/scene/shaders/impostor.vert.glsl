attribute vec3 iColor;
attribute float iFade;
varying vec3 vColor;
varying float vFade;

void main() {
  vColor = iColor;
  vFade  = iFade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
