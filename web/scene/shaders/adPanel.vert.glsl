// adPanel.vert.glsl — Per-instance ad panel quad for the cell rendering path.
//
// Geometry: PlaneGeometry(1, 1) lying in the XY plane. The caller sizes
// each instance via instanceMatrix (position, Y-axis rotation, scale).
//
// Per-instance attributes:
//   iLayerIndex  — float: layer in the DataArrayTexture for this instance's media
//   iColor       — vec3:  placeholder / tint color in linear RGB
//   iTextureFade — float: 0 = color-only placeholder, 1 = full texture, 0..1 during fade-in
//
// COMPILATION NOTES (Three.js ShaderMaterial, v0.184.0):
//   - glslVersion: THREE.GLSL3 is set on the material — sampler2DArray requires GLSL ES 3.00.
//   - `instanceMatrix` (mat4) is injected under #ifdef USE_INSTANCING.
//   - `position`, `uv` are always injected by Three.js.
//   - In GLSL3 mode Three.js maps `attribute` → `in`, `varying` → `out` (vertex).

attribute float iLayerIndex;
attribute vec3 iColor;
attribute float iTextureFade;

out vec2 vUv;
out float vLayerIndex;
out vec3 vColor;
out float vTextureFade;

void main() {
  // Flip V to compensate for the data orientation in adPanelTextureArray.
  // uploadImage/uploadCanvas populate the DataArrayTexture via
  // ctx.getImageData(), which returns canvas rows top-down (row 0 = top
  // of the image). WebGL's UV origin is at the bottom, so without a flip
  // the image's top row would render at the bottom of the quad (image
  // appears upside-down). Three.js's Texture.flipY (which normally
  // handles this for HTMLImage/HTMLCanvas uploads) has no effect on
  // DataTexture / DataArrayTexture — typed-array uploads bypass
  // UNPACK_FLIP_Y_WEBGL — so the flip has to happen here.
  vUv = vec2(uv.x, 1.0 - uv.y);
  vLayerIndex = iLayerIndex;
  vColor = iColor;
  vTextureFade = iTextureFade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
