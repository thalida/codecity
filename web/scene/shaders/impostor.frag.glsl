precision mediump float;
varying vec3 vColor;
varying float vFade;

void main() {
  gl_FragColor = vec4(vColor, vFade);
}
