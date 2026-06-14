
attribute vec3 color;
attribute float ao;

varying vec3 vColor;
varying vec3 vNormalWorld;
varying vec3 vWorldPos;
varying float vAO;

void main() {
  vColor = color;
  vAO = ao;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
