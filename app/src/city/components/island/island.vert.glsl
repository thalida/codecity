
attribute vec3 color;
attribute float ao;
attribute float aSurface;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying float vAO;
varying vec3 vWorldPos;
varying float vSurface;

void main() {
  vColor = color;
  vAO = ao;
  vSurface = aSurface;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
